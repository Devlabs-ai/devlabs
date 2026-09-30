'use strict';

/**
 * Interactive kubectl shell for kubernetes lab sessions (xterm.js via PTY).
 * Mints a short-lived kubeconfig for the per-namespace learner ServiceAccount
 * (Role/RoleBinding), then spawns bash with that KUBECONFIG. With
 * K8S_LAB_SHELL_MODE=container, bash runs in an isolated per-terminal
 * container (see workspace/labShell) instead of inside the backend.
 */

import type { IncomingMessage } from 'http';
import type { IPty, ObservabilityWebSocket } from '../types/ws';

const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('node-pty');
const sessionStore = require('../db/sessionStore');
const k8sCluster = require('../workspace/k8sCluster');
const labShell = require('../workspace/labShell');
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

/** Per-learner lab home: /Users/<user-name> (or K8S_LAB_HOME_ROOT / Linux /home). */
function learnerUserName(session: {
  k8sNamespace?: string | null;
  workspacePrefix?: string | null;
  userId?: string | null;
  candidateName?: string | null;
}): string {
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
  const userName = learnerUserName(session);
  const labHome = ensureLearnerHome(userName);
  const cols = parseInt(q.get('cols') || '120', 10) || 120;
  const rows = parseInt(q.get('rows') || '32', 10) || 32;

  void (async () => {
    let kubeconfigPath: string;
    try {
      kubeconfigPath = await k8sCluster.createLearnerKubeconfig(ns);
    } catch (err: unknown) {
      sendJson(ws, {
        type: 'error',
        message: `learner kubeconfig setup failed: ${(err as Error).message}`,
      });
      ws.close();
      return;
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
          return;
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
      console.error(`[k8s-terminal] session=${sessionId} spawn failed: ${(err as Error).message}`);
      sendJson(ws, { type: 'error', message: 'terminal could not start; please retry in a moment' });
      ws.close();
      return;
    }

    console.log(
      `[k8s-terminal] session=${sessionId} ns=${ns} user=${userName} home=${labHome} sa=${k8sCluster.LEARNER_SA} challenge=${challengeId}${containerName ? ` container=${containerName}` : ''}`,
    );
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
      if (containerName) labShell.stopShellContainer(containerName);
      k8sCluster.removeLearnerKubeconfig(kubeconfigPath);
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

    child.onData((data: string) => {
      send(ws, Buffer.from(data, 'utf8'));
    });

    child.onExit(({ exitCode, signal }: { exitCode: number; signal: number }) => {
      console.log(`[k8s-terminal] session=${sessionId} exited code=${exitCode} signal=${signal}`);
      closeAll();
    });

    ws.on('close', () => closeAll());
    ws.on('error', () => closeAll());

    send(
      ws,
      Buffer.from(
        `\r\n\x1b[1mDevLabs Kubernetes lab\x1b[0m\r\n`
          + `Home: \x1b[36m${displayHome}\x1b[0m   Namespace: \x1b[32m${ns}\x1b[0m\r\n`
          + `Files saved in the Editor tab land here — try: ls, then kubectl apply -f <file>\r\n\r\n`,
      ),
    );
  })();
}

module.exports = { handleConnection };
