'use strict';

/**
 * Interactive shell for cluster lab sessions (xterm.js via PTY).
 *
 * Kubernetes labs: mints a short-lived kubeconfig for the per-namespace learner
 * ServiceAccount (Role/RoleBinding), then spawns bash with that KUBECONFIG. With
 * K8S_LAB_SHELL_MODE=container, bash runs in an isolated per-terminal container
 * (see workspace/labShell) instead of inside the backend.
 *
 * Box labs (Linux, Docker): a login shell as `learner` inside the lab's box pod
 * (workspace/linuxBox), via kubectl exec with controller credentials; the learner
 * never holds any.
 */

import type { IncomingMessage } from 'http';
import type { IPty, ObservabilityWebSocket } from '../types/ws';
import type { BoxFlavor } from '../types/domain';

const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('node-pty');
const sessionStore = require('../db/sessionStore');
const loader = require('../challenges/loader');
const { boxFlavor } = require('../challenges/labTypes');
const k8sCluster = require('../workspace/k8sCluster');
const labShell = require('../workspace/labShell');
const linuxBox = require('../workspace/linuxBox');
const sessionIdle = require('../workspace/sessionIdle');
const sessionExclusivity = require('../workspace/sessionExclusivity');
const terminalEventBus = require('./terminalEventBus');

type OpenTerminal = { clientId: string | null; close: (notice?: string) => void };

/** sessionId → its open terminals and the tab that opened each. */
const openTerminals = new Map<string, Set<OpenTerminal>>();

const MOVED_NOTICE = 'This lab was opened in another tab, so this terminal was disconnected.';

// A finished lab is parked and its namespace handed to the next lab, so a shell
// left open must not keep writing into it.
terminalEventBus.on('session_end', ({ sessionId }: { sessionId?: string }) => {
  const terms = sessionId ? openTerminals.get(sessionId) : undefined;
  if (!terms) return;
  openTerminals.delete(sessionId!);
  introShownSessions.delete(sessionId!);
  for (const t of terms) t.close();
});

// Only the tab holding the lease may drive the lab.
sessionExclusivity.onLeaseMoved((sessionId: string, clientId: string) => {
  const terms = openTerminals.get(sessionId);
  if (!terms) return;
  for (const t of [...terms]) {
    if (t.clientId !== clientId) t.close(MOVED_NOTICE);
  }
});

function parseQuery(req: IncomingMessage): URLSearchParams {
  try {
    return new URL(req.url || '', `http://${(req.headers as Record<string, string>).host}`).searchParams;
  } catch (_e) {
    return new URLSearchParams();
  }
}

function send(ws: ObservabilityWebSocket, data: string | Buffer | Uint8Array): void {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(data);
    } catch (_e) {
      /* socket dead */
    }
  }
}

function sendJson(ws: ObservabilityWebSocket, obj: unknown): void {
  send(ws, JSON.stringify(obj));
}

function sendNotice(ws: ObservabilityWebSocket, message: string): void {
  send(ws, Buffer.from(`\r\n\x1b[33m${message}\x1b[0m\r\n`, 'utf8'));
}

type SessionNames = {
  k8sNamespace?: string | null;
  workspacePrefix?: string | null;
  userId?: string | null;
  candidateName?: string | null;
};

/** Per-learner lab home: /Users/<user-name> (or K8S_LAB_HOME_ROOT / Linux /home). */
function learnerUserName(session: SessionNames): string {
  const ns = String(session.k8sNamespace || session.workspacePrefix || '');
  if (ns.startsWith('ns-') && ns.length > 3) {
    return ns.slice(3);
  }
  const raw = String(session.candidateName || session.userId || 'learner')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return raw || 'learner';
}

function defaultHomeRoot(): string {
  const fromEnv = String(process.env.K8S_LAB_HOME_ROOT || '').trim();
  if (fromEnv) return fromEnv;
  return process.platform === 'darwin' ? '/Users' : '/home';
}

function ensureLearnerHome(userName: string): string {
  const root = defaultHomeRoot();
  const preferred = path.join(root, userName);
  let home: string;
  try {
    fs.mkdirSync(preferred, { recursive: true, mode: 0o700 });
    fs.accessSync(preferred, fs.constants.W_OK);
    home = preferred;
  } catch (err: unknown) {
    const fallback = path.join(os.homedir(), 'devlabs-homes', userName);
    fs.mkdirSync(fallback, { recursive: true, mode: 0o700 });
    console.warn(
      `[k8s-terminal] could not use ${preferred} (${(err as Error).message}); using ${fallback}`,
    );
    home = fallback;
  }

  // Drop leftover lab YAML vim / editorconfig so stock vi/vim is used.
  for (const name of ['.vimrc', '.editorconfig']) {
    const p = path.join(home, name);
    try {
      if (!fs.existsSync(p)) continue;
      const body = fs.readFileSync(p, 'utf8');
      if (
        name === '.vimrc'
          ? /DevLabs lab vim|DevLabsYaml/i.test(body)
          : /\[\*\{yml,yaml\}\]|indent_size = 2/.test(body)
      ) {
        fs.unlinkSync(p);
      }
    } catch (err: unknown) {
      console.warn(`[k8s-terminal] could not remove ${p}: ${(err as Error).message}`);
    }
  }
  return home;
}

function handleConnection(ws: ObservabilityWebSocket, req: IncomingMessage): void {
  const q = parseQuery(req);
  const sessionId = q.get('sessionId');

  if (!sessionId) {
    sendJson(ws, { type: 'error', message: 'sessionId is required' });
    ws.close();
    return;
  }

  const session = sessionStore.get(sessionId);
  if (!session || session.runtime !== 'kubernetes') {
    sendJson(ws, { type: 'error', message: 'kubernetes session not found' });
    ws.close();
    return;
  }
  if (session.status !== 'active') {
    sendJson(ws, { type: 'error', message: 'session is not active' });
    ws.close();
    return;
  }

  const clientId = (q.get('clientId') || '').trim().slice(0, 128) || null;
  if (!sessionExclusivity.isLeaseHolder(sessionId, clientId)) {
    sendNotice(ws, MOVED_NOTICE);
    ws.close();
    return;
  }

  const ns = String(session.k8sNamespace || session.workspacePrefix || '');
  if (!ns) {
    sendJson(ws, { type: 'error', message: 'session missing namespace' });
    ws.close();
    return;
  }

  const challengeId = String(session.challengeId || '');
  const cols = parseInt(q.get('cols') || '120', 10) || 120;
  const rows = parseInt(q.get('rows') || '32', 10) || 32;
  const target: ShellTarget = { sessionId, ns, challengeId, cols, rows };
  const flavor: BoxFlavor | null = boxFlavor(loader.getChallenge(challengeId)?.sandboxType);

  void (async () => {
    const started = flavor
      ? await startBoxShell(ws, target, flavor)
      : await startKubectlShell(ws, target, session);
    if (!started) return;
    attachShell(ws, sessionId, clientId, started, cols);
  })();
}

type ShellTarget = { sessionId: string; ns: string; challengeId: string; cols: number; rows: number };

type StartedShell = {
  child: IPty;
  /** Releases what the shell holds (container, kubeconfig) once the PTY is killed. */
  cleanup: () => void;
  banner: string;
};

function spawnFailed(ws: ObservabilityWebSocket, sessionId: string, err: unknown): null {
  console.error(`[k8s-terminal] session=${sessionId} spawn failed: ${(err as Error).message}`);
  sendJson(ws, { type: 'error', message: 'terminal could not start; please retry in a moment' });
  ws.close();
  return null;
}

// The subtitle under the logo. Same for free and paid (no sudo/root wording): the tiers
// differ under the hood, but the pitch to the learner is identical.
const BOX_SUBTITLES: Record<BoxFlavor, string> = {
  linux:
    `\x1b[1;36m⚡ This box is yours\x1b[0m \x1b[1m— a real Linux machine, powered by a real kernel.\x1b[0m\r\n`
    + `\x1b[38;5;245mExplore it, break it, rebuild it — it comes back fresh every time you open the lab.\x1b[0m\r\n`,
  docker:
    `\x1b[1;36m🐳 This box is yours\x1b[0m \x1b[1m— a real Linux machine with Docker baked in.\x1b[0m\r\n`
    + `\x1b[38;5;245mBuild it, run it, break it, rebuild it — it comes back fresh every time you open the lab.\x1b[0m\r\n`,
};

// ---- Intro banner: DEVSETU wordmark with a left-to-right colour sweep ------------
// Shown once per session (animated), then static on reconnects. Each glyph is a fixed
// set of rows so the wordmark is assembled column-aligned and coloured per column.

const LOGO_FONT: Record<string, string[]> = {
  D: ['█████ ', '██  ██', '██  ██', '██  ██', '█████ '],
  E: ['█████', '██   ', '████ ', '██   ', '█████'],
  V: ['██  ██', '██  ██', '██  ██', ' ████ ', '  ██  '],
  S: ['█████', '██   ', '█████', '   ██', '█████'],
  T: ['██████', '  ██  ', '  ██  ', '  ██  ', '  ██  '],
  U: ['██  ██', '██  ██', '██  ██', '██  ██', ' ████ '],
};
const LOGO_WORD = 'DEVSETU';
const LOGO_ROWS = 5;
const LOGO_LINES = Array.from({ length: LOGO_ROWS }, (_unused, r) =>
  LOGO_WORD.split('').map((ch) => LOGO_FONT[ch][r]).join(' '),
);
const LOGO_WIDTH = LOGO_LINES[0].length;
/** Below this terminal width, skip the logo (would wrap): fall back to a plain line. */
const LOGO_MIN_COLS = LOGO_WIDTH + 2;

const CSI = '\x1b[';
const RESET = '\x1b[0m';
// Settled wordmark colours, left→right (xterm-256): cyan into indigo.
const SWEEP_GRADIENT = [51, 50, 44, 38, 39, 33, 69, 63, 99, 135, 171, 177];
const SWEEP_DIM = '\x1b[38;5;238m';
const SWEEP_GLOW = '\x1b[1;38;5;231m';
const SWEEP_BAND = 6;
const SWEEP_STEP = 3;
const SWEEP_FRAME_MS = 24;

function sweepColor(col: number, sweep: number): string {
  if (col > sweep) return SWEEP_DIM;
  if (col > sweep - SWEEP_BAND) return SWEEP_GLOW;
  const i = Math.min(SWEEP_GRADIENT.length - 1, Math.floor((col / LOGO_WIDTH) * SWEEP_GRADIENT.length));
  return `\x1b[38;5;${SWEEP_GRADIENT[i]}m`;
}

/** The wordmark at one sweep position (sweep ≥ LOGO_WIDTH+band ⇒ settled gradient). */
function logoFrame(sweep: number): string {
  let out = '';
  for (let r = 0; r < LOGO_ROWS; r++) {
    const line = LOGO_LINES[r];
    let active = '';
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const code = ch === ' ' ? '' : sweepColor(c, sweep);
      if (code !== active) {
        out += code || RESET;
        active = code;
      }
      out += ch;
    }
    out += `${RESET}${CSI}K\r\n`;
  }
  return out;
}

const LOGO_SETTLED = LOGO_WIDTH + SWEEP_BAND;
const delay = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/** Full intro, no motion: settled logo (when it fits) + subtitle. */
function staticBanner(subtitle: string, cols: number): string {
  if (cols < LOGO_MIN_COLS) return `\r\n${subtitle}\r\n`;
  return `\r\n${logoFrame(LOGO_SETTLED)}\r\n${subtitle}\r\n`;
}

/** Play the colour sweep in place, then print the subtitle. */
async function animateBanner(ws: ObservabilityWebSocket, subtitle: string): Promise<void> {
  send(ws, Buffer.from(`${CSI}?25l\r\n${logoFrame(-SWEEP_BAND)}`));
  for (let sweep = -SWEEP_BAND + SWEEP_STEP; sweep <= LOGO_SETTLED; sweep += SWEEP_STEP) {
    if (ws.readyState !== ws.OPEN) break;
    await delay(SWEEP_FRAME_MS);
    send(ws, Buffer.from(`${CSI}${LOGO_ROWS}A${logoFrame(sweep)}`));
  }
  send(ws, Buffer.from(`${CSI}?25h\r\n${subtitle}\r\n`));
}

/** Sessions that have already seen the animated intro (static on later opens). */
const introShownSessions = new Set<string>();

/** Box labs: login shell as `learner` inside the lab's box pod. */
async function startBoxShell(
  ws: ObservabilityWebSocket,
  { sessionId, ns, challengeId, cols, rows }: ShellTarget,
  flavor: BoxFlavor,
): Promise<StartedShell | null> {
  let child: IPty;
  try {
    const cmd = await k8sCluster.controllerKubectlCommand(linuxBox.shellExecArgs(ns));
    child = pty.spawn('kubectl', cmd.args, {
      name: 'xterm-256color',
      cols,
      rows,
      env: { ...cmd.env, TERM: 'xterm-256color' },
    });
  } catch (err: unknown) {
    return spawnFailed(ws, sessionId, err);
  }
  console.log(`[k8s-terminal] session=${sessionId} ns=${ns} pod=${linuxBox.BOX_POD} challenge=${challengeId}`);
  return {
    child,
    cleanup: () => undefined,
    banner: BOX_SUBTITLES[flavor],
  };
}

/** Kubernetes labs: kubectl shell with the namespace's learner ServiceAccount. */
async function startKubectlShell(
  ws: ObservabilityWebSocket,
  { sessionId, ns, challengeId, cols, rows }: ShellTarget,
  session: SessionNames,
): Promise<StartedShell | null> {
  const userName = learnerUserName(session);
  const labHome = ensureLearnerHome(userName);

  let kubeconfigPath: string;
  try {
    kubeconfigPath = await k8sCluster.createLearnerKubeconfig(ns);
  } catch (err: unknown) {
    sendJson(ws, {
      type: 'error',
      message: `learner kubeconfig setup failed: ${(err as Error).message}`,
    });
    ws.close();
    return null;
  }

  const shellEnv: Record<string, string> = {
    USER: userName,
    LOGNAME: userName,
    TERM: 'xterm-256color',
    LEARNER_NS: ns,
    CHALLENGE_ID: challengeId,
    EDITOR: 'vi',
    VISUAL: 'vi',
    KUBE_EDITOR: 'vi',
    PS1: `\\[\\e[1;32m\\]${userName}\\[\\e[0m\\]:\\w $ `,
  };

  let containerName: string | null = null;
  let displayHome = labHome;
  let child: IPty;
  try {
    if (labShell.enabled()) {
      const started = await labShell.startShellContainer({
        sessionId,
        userName,
        ns,
        challengeId,
        labHome,
        kubeconfigPath,
        env: shellEnv,
      });
      containerName = started.name;
      displayHome = started.home;
      if (ws.readyState !== ws.OPEN) {
        labShell.stopShellContainer(started.name);
        return null;
      }
      child = pty.spawn('docker', labShell.execArgs(started.name), {
        name: 'xterm-256color',
        cols,
        rows,
        env: { PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin', TERM: 'xterm-256color' },
      });
    } else {
      // Non-login / non-rc shell so host profiles cannot overwrite KUBECONFIG.
      child = pty.spawn('/bin/bash', ['--noprofile', '--norc'], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: labHome,
        env: {
          ...shellEnv,
          PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
          HOME: labHome,
          KUBECONFIG: kubeconfigPath,
        },
      });
    }
  } catch (err: unknown) {
    if (containerName) labShell.stopShellContainer(containerName);
    k8sCluster.removeLearnerKubeconfig(kubeconfigPath);
    return spawnFailed(ws, sessionId, err);
  }

  console.log(
    `[k8s-terminal] session=${sessionId} ns=${ns} user=${userName} home=${labHome} sa=${k8sCluster.LEARNER_SA} challenge=${challengeId}${containerName ? ` container=${containerName}` : ''}`,
  );
  return {
    child,
    cleanup: () => {
      if (containerName) labShell.stopShellContainer(containerName);
      k8sCluster.removeLearnerKubeconfig(kubeconfigPath);
    },
    banner:
      `\x1b[1mKubernetes lab\x1b[0m\r\n`
      + `Home: \x1b[36m${displayHome}\x1b[0m   Namespace: \x1b[32m${ns}\x1b[0m\r\n`
      + `Files saved in the Editor tab land here — try: ls, then kubectl apply -f <file>\r\n`,
  };
}

/** Wire a started shell to the socket: input, resize, output, and teardown. */
function attachShell(
  ws: ObservabilityWebSocket,
  sessionId: string,
  clientId: string | null,
  { child, cleanup, banner }: StartedShell,
  cols: number,
): void {
  sessionIdle.touch(sessionId);

  let closed = false;
  const closeAll = (notice?: string) => {
    if (closed) return;
    closed = true;
    openTerminals.get(sessionId)?.delete(entry);
    if (notice) sendNotice(ws, notice);
    try {
      child.kill('SIGTERM');
    } catch (_e) {
      /* noop */
    }
    cleanup();
    if (ws.readyState === ws.OPEN) ws.close();
  };
  const entry: OpenTerminal = { clientId, close: closeAll };
  if (!openTerminals.has(sessionId)) openTerminals.set(sessionId, new Set());
  openTerminals.get(sessionId)!.add(entry);
  // The lab may have ended, or moved to another tab, while the shell was starting.
  if (sessionStore.get(sessionId)?.status !== 'active') {
    closeAll();
    return;
  }
  if (!sessionExclusivity.isLeaseHolder(sessionId, clientId)) {
    closeAll(MOVED_NOTICE);
    return;
  }

  ws.on('message', (msg: unknown) => {
    const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg as ArrayBuffer);
    sessionIdle.touch(sessionId);
    if (buf.length > 0 && buf[0] === 0x7b /* { */) {
      const asText = buf.toString('utf8');
      if (/^\{\s*"type"\s*:\s*"resize"/.test(asText)) {
        try {
          const parsed = JSON.parse(asText) as { type?: string; cols?: number; rows?: number };
          if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
            try {
              child.resize(parsed.cols, parsed.rows);
            } catch (_e) {
              /* noop */
            }
            return;
          }
        } catch (_e) {
          /* fall through */
        }
      }
    }
    try {
      child.write(buf);
    } catch (_e) {
      /* noop */
    }
  });

  // Hold the shell's output until the intro banner is on screen, so the prompt can't
  // interleave with (or race ahead of) the banner / sweep animation.
  let introDone = false;
  const pending: Buffer[] = [];
  child.onData((data: string) => {
    const buf = Buffer.from(data, 'utf8');
    if (!introDone) {
      pending.push(buf);
      return;
    }
    send(ws, buf);
  });

  child.onExit(({ exitCode, signal }: { exitCode: number; signal: number }) => {
    console.log(`[k8s-terminal] session=${sessionId} exited code=${exitCode} signal=${signal}`);
    closeAll();
  });

  ws.on('close', () => closeAll());
  ws.on('error', () => closeAll());

  // Animate on the first open per session (if the terminal is wide enough), static after.
  const animate = cols >= LOGO_MIN_COLS && !introShownSessions.has(sessionId);
  if (animate) introShownSessions.add(sessionId);
  void (async () => {
    if (animate) await animateBanner(ws, banner);
    else send(ws, Buffer.from(staticBanner(banner, cols)));
    introDone = true;
    for (const buf of pending) send(ws, buf);
    pending.length = 0;
  })();
}

module.exports = { handleConnection };
