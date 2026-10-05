'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';
import type { GameSession } from '../types/domain';

const express = require('express');
const { spawn } = require('child_process');
const { requireSessionAccess } = require('../auth/middleware');
const lifecycle = require('../sandbox/sessionLifecycle');
const sparkLifecycle = require('../workspace/sparkLifecycle');
const sparkJobs = require('../workspace/sparkJobs');
const boardLifecycle = require('../workspace/boardLifecycle');
const k8sLifecycle = require('../workspace/k8sLifecycle');
const k8sCapacity = require('../workspace/k8sCapacity');
const k8sGrade = require('../workspace/k8sGrade');
const k8sCluster = require('../workspace/k8sCluster');
const k8sLabFiles = require('../workspace/k8sLabFiles');
const { isBoxLabType } = require('../challenges/labTypes');
const { publicBoardSpec } = require('../workspace/boardGrade');
const workspaceStore = require('../workspace/workspaceStore');
const sessionStore = require('../db/sessionStore');
const loader = require('../challenges/loader');
const { hydrateChallengeFromMinio, applyMoatPolicy } = require('../challenges/minioChallengeAssets');
const { canViewChallenge } = require('../challenges/access');
const terminalEventBus = require('../observability/terminalEventBus');
const sessionIdle = require('../workspace/sessionIdle');
const sessionExclusivity = require('../workspace/sessionExclusivity');
const { handleBrowse, listBrowseServices } = require('../sandbox/sessionBrowseProxy');

const router = express.Router();

/** Any /:id session traffic counts as activity (keeps idle timer fresh). */
router.param('id', (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction, id: string) => {
  const p = String(req.path || '');
  const leaseRoute = p.endsWith('/heartbeat') || p.endsWith('/lease/release');
  // A tab that lost the lab to another tab may still read, but not change it.
  if (id && !leaseRoute && req.method !== 'GET' && req.method !== 'HEAD') {
    const header = req.headers['x-lab-client'];
    const clientId = typeof header === 'string' && header.trim() ? header.trim().slice(0, 128) : null;
    if (!sessionExclusivity.isLeaseHolder(id, clientId)) {
      return res.status(409).json({
        error: 'This lab is open in another tab or window.',
        code: 'LAB_OPEN_IN_OTHER_TAB',
      });
    }
  }
  // Tab heartbeats prove the tab is open, not that the learner is active.
  if (id && !p.endsWith('/end') && !leaseRoute) {
    sessionIdle.touch(id);
  }
  next();
});

/** Relative workspace path (no leading slash, no ..). */
function safeWorkspacePath(p: unknown): string | null {
  if (!p || typeof p !== 'string') return null;
  const trimmed = p.replace(/^\/+/, '');
  if (!trimmed || trimmed.includes('..') || trimmed.includes('\\')) return null;
  return trimmed;
}

function parseStarterFiles(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const path = safeWorkspacePath(key);
    if (!path || typeof value !== 'string') continue;
    out[path] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function getBoardSession(id: string, res: ExpressResponse): GameSession | null {
  const session = sessionStore.get(id);
  if (!session) { res.status(404).json({ error: 'session not found' }); return null; }
  if (session.runtime !== 'board') {
    res.status(409).json({ error: 'not a board session' });
    return null;
  }
  return session;
}

function getSparkSession(id: string, res: ExpressResponse): GameSession | null {
  const session = sessionStore.get(id);
  if (!session) { res.status(404).json({ error: 'session not found' }); return null; }
  if (session.runtime !== 'spark-platform' || !session.workspacePrefix) {
    res.status(409).json({ error: 'not a spark-platform workspace session' });
    return null;
  }
  if (session.status !== 'active') {
    res.status(409).json({ error: 'session is not active' });
    return null;
  }
  return session;
}

function getK8sSession(id: string, res: ExpressResponse): GameSession | null {
  const session = sessionStore.get(id);
  if (!session) { res.status(404).json({ error: 'session not found' }); return null; }
  if (session.runtime !== 'kubernetes') {
    res.status(409).json({ error: 'not a kubernetes lab session' });
    return null;
  }
  if (session.status !== 'active') {
    res.status(409).json({ error: 'session is not active' });
    return null;
  }
  const ns = session.k8sNamespace || session.workspacePrefix;
  if (!ns) {
    res.status(409).json({ error: 'session missing namespace' });
    return null;
  }
  return session;
}

/** Kubernetes-flavor labs only: learner kubectl and the lab-home file editor have no box-lab counterpart. */
function getKubectlLabSession(id: string, res: ExpressResponse): GameSession | null {
  const session = getK8sSession(id, res);
  if (!session) return null;
  if (isBoxLabType(loader.getChallenge(String(session.challengeId || ''))?.sandboxType)) {
    res.status(409).json({ error: 'not available in Linux or Docker labs' });
    return null;
  }
  return session;
}

function parseSparkKnobs(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || !k || k.length > 128) continue;
    if (v == null) continue;
    const s = String(v).trim();
    if (!s || s.length > 64) continue;
    out[k] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

// Reject any path containing ".." segments to prevent path traversal.
function safePath(p: unknown): string | null {
  if (!p || typeof p !== 'string') return null;
  const parts = p.split('/');
  if (parts.some((seg) => seg === '..')) return null;
  return p.startsWith('/') ? p : `/${p}`;
}

function getSession(id: string, res: ExpressResponse): GameSession | null {
  const session = sessionStore.get(id);
  if (!session) { res.status(404).json({ error: 'session not found' }); return null; }
  if (!session.buildDir) { res.status(409).json({ error: 'sandbox not running' }); return null; }
  return session;
}

// GET /api/session/:id/file?path=<abs-path>&container=<service>
router.get('/:id/file', async (req: ExpressRequest, res: ExpressResponse) => {
  const session = getSession(req.params.id, res);
  if (!session) return;

  const filePath = safePath(req.query.path);
  if (!filePath) return res.status(400).json({ error: 'invalid path' });

  const container = (req.query.container as string) || session.terminalService || (session.services || [])[0];
  if (!container) return res.status(400).json({ error: 'no container specified' });

  const child = spawn(
    'docker',
    ['compose', 'exec', '-T', container, 'cat', filePath],
    { cwd: session.buildDir, env: process.env },
  );

  let content = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => { content += d.toString(); });
  child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
  child.on('error', (err: Error) => res.status(500).json({ error: err.message }));
  child.on('close', (code: number | null) => {
    if (code !== 0) {
      return res.status(404).json({ error: `file not found or unreadable: ${stderr.trim()}` });
    }
    res.json({ path: filePath, container, content });
  });
});

// POST /api/session/:id/file  { path, content, container }
router.post('/:id/file', express.json({ limit: '2mb' }), async (req: ExpressRequest, res: ExpressResponse) => {
  const session = getSession(req.params.id, res);
  if (!session) return;

  const body = (req.body as Record<string, unknown>) || {};
  const filePath = safePath(body?.path);
  if (!filePath) return res.status(400).json({ error: 'invalid path' });

  const { content = '', container: reqContainer } = body;
  const container = (reqContainer as string) || session.terminalService || (session.services || [])[0];
  if (!container) return res.status(400).json({ error: 'no container specified' });

  // Use `tee` to write content from stdin into the file inside the container.
  const child = spawn(
    'docker',
    ['compose', 'exec', '-T', container, 'sh', '-c', `tee '${filePath}' > /dev/null`],
    { cwd: session.buildDir, env: process.env },
  );

  let stderr = '';
  child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
  child.on('error', (err: Error) => res.status(500).json({ error: err.message }));
  child.on('close', (code: number | null) => {
    if (code !== 0) {
      return res.status(500).json({ error: `write failed: ${stderr.trim()}` });
    }
    res.json({ ok: true, path: filePath, container });
  });

  child.stdin.write(content);
  child.stdin.end();
});

const PORT = parseInt(process.env.PORT || '4000', 10);
const BACKEND_HOST = `localhost:${PORT}`;

// Services that run in the background for metrics/load but should never be
// exposed to candidates as interactive terminal tabs or editor targets.
const HIDDEN_SERVICE_PATTERNS = [
  /^load[-_]?gen(erator)?$/i,
  /^load[-_]?generator[-_]/i,
  /^traffic[-_]?gen(erator)?$/i,
];

function isHiddenService(name: string): boolean {
  return HIDDEN_SERVICE_PATTERNS.some((re) => re.test(name));
}

function candidateServices(allServices: unknown): string[] {
  const list = Array.isArray(allServices) && allServices.length > 0
    ? (allServices as string[])
    : [];
  const visible = list.filter((s) => !isHiddenService(s));
  return visible.length > 0 ? visible : list;
}

function publicSession(
  s: GameSession,
  challenge: unknown,
  user?: { sub?: string; userId?: string; email?: string } | null,
): Record<string, unknown> {
  const c = applyMoatPolicy(
    challenge && typeof challenge === 'object' ? (challenge as Record<string, unknown>) : null,
    user,
  );
  return {
    id: s.id,
    status: s.status,
    challengeId: s.challengeId,
    candidateName: s.candidateName,
    startTime: s.startTime,
    endTime: s.endTime,
    recovered: s.recovered,
    runtime: s.runtime || (s.buildDir ? 'compose' : null),
    workspacePrefix: s.workspacePrefix || null,
    k8sNamespace: s.runtime === 'kubernetes'
      ? (s.k8sNamespace || s.workspacePrefix || null)
      : null,
    entrypoint: s.entrypoint || null,
    workspaceUpdatedAt: s.workspaceUpdatedAt || null,
    boardState: s.runtime === 'board' ? (s.boardState || null) : null,
    services: candidateServices(
      Array.isArray(s.services) && s.services.length > 0
        ? s.services
        : Object.keys(s.portMap || {}),
    ),
    portMap: s.portMap,
    metricsService: s.metricsService,
    terminalService: s.terminalService,
    challenge: c
      ? {
          id: c.id,
          title: c.title,
          description: c.description,
          difficulty: c.difficulty,
          tags: c.tags,
          category: c.category,
          sandboxType: c.sandboxType,
          contentSource: c.contentSource || null,
          problemStatement: c.problemStatement,
          sparkPlatform: c.sparkPlatform || null,
          k8sPlatform: c.k8sPlatform || null,
          boardSpec: publicBoardSpec(c.boardSpec || null),
        }
      : null,
  };
}

router.post('/start', requireSessionAccess, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const body = (req.body as Record<string, unknown>) || {};
    const { challengeId } = body;
    const { session, challenge } = await lifecycle.start({ challengeId });

    const pub = publicSession(session, challenge, req.user);
    res.status(201).json({
      sessionId: session.id,
      status: session.status,
      terminalWsUrl: `ws://${BACKEND_HOST}/ws/terminal?sessionId=${session.id}`,
      metricsWsUrl: `ws://${BACKEND_HOST}/ws/metrics?sessionId=${session.id}`,
      services: pub.services,
      terminalService: pub.terminalService,
      challenge: pub.challenge,
      session: pub,
    });
  } catch (e) {
    next(e);
  }
});

function clientIdFrom(body: Record<string, unknown>): string | null {
  const raw = typeof body.clientId === 'string' ? body.clientId.trim() : '';
  return raw && raw.length <= 128 ? raw : null;
}

/** One active lab per user, one tab per lab; `force` ends the other lab / takes over the tab. */
async function claimLabSlot(
  req: ExpressRequest,
  challengeId: string,
  userId: string | null,
): Promise<string | null> {
  const body = (req.body as Record<string, unknown>) || {};
  const clientId = clientIdFrom(body);
  await sessionExclusivity.assertCanStart({
    userId,
    challengeId,
    clientId,
    force: body.force === true,
    endSession: (sessionId: string) => sessionIdle.endSessionById(sessionId, 'replaced-by-new-lab'),
  });
  return clientId;
}

/** Conflicts carry a machine-readable code the client uses to offer "end it" / "use here". */
function sendStartError(e: unknown, res: ExpressResponse, next: ExpressNextFunction): void {
  const err = e as Error & { status?: number; code?: string; details?: Record<string, unknown> };
  if (err && (err.status === 409 || err.status === 503) && err.code) {
    res.status(err.status).json({ error: err.message, code: err.code, ...(err.details || {}) });
    return;
  }
  next(e);
}

function assertChallengeAccess(req: ExpressRequest, challengeId: string | null | undefined): void {
  if (!challengeId || challengeId === 'spark-playground') return;
  const listed = loader.getChallenge(challengeId);
  if (!listed) return;
  if (!listed.finalized) {
    const err = new Error('This lab is not open yet');
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
  if (!canViewChallenge(req.user, listed.visibleTo)) {
    const err = new Error('This lab is not available for your role');
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}

// POST /api/session/spark/start  { challengeId, starterFiles?, entrypoint? }
// Starter defaults to MinIO challenges/<id>/starter/ when starterFiles omitted.
router.post('/spark/start', requireSessionAccess, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const body = (req.body as Record<string, unknown>) || {};
    const challengeId = body.challengeId as string;
    const starterFiles = (body.starterFiles as Record<string, string> | undefined) || null;
    const entrypoint = (body.entrypoint as string | undefined) || undefined;
    const userId = (req.user as { sub?: string; id?: string } | undefined)?.sub
      || (req.user as { sub?: string; id?: string } | undefined)?.id
      || null;

    assertChallengeAccess(req, challengeId);
    const clientId = await claimLabSlot(req, challengeId, userId);

    const { session, created } = await sparkLifecycle.startSparkSession({
      challengeId,
      userId,
      candidateName: null,
      entrypoint,
      starterFiles,
    });
    sessionExclusivity.heartbeat(session.id, clientId, true);

    const base = loader.getPublicChallenge(challengeId) || loader.getChallenge(challengeId);
    const challenge = await hydrateChallengeFromMinio(base);
    const pub = publicSession(session, challenge, req.user);
    res.status(created ? 201 : 200).json({
      sessionId: session.id,
      created,
      status: session.status,
      runtime: 'spark-platform',
      workspacePrefix: session.workspacePrefix,
      entrypoint: session.entrypoint,
      session: pub,
      challenge: pub.challenge,
    });
  } catch (e) {
    sendStartError(e, res, next);
  }
});

// POST /api/session/board/start  { challengeId }
router.post('/board/start', requireSessionAccess, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const body = (req.body as Record<string, unknown>) || {};
    const challengeId = body.challengeId as string;
    const userId = (req.user as { sub?: string; id?: string } | undefined)?.sub
      || (req.user as { sub?: string; id?: string } | undefined)?.id
      || null;

    assertChallengeAccess(req, challengeId);
    const clientId = await claimLabSlot(req, challengeId, userId);

    const { session, created } = await boardLifecycle.startBoardSession({
      challengeId,
      userId,
      candidateName: null,
    });
    sessionExclusivity.heartbeat(session.id, clientId, true);

    const base = loader.getPublicChallenge(challengeId) || loader.getChallenge(challengeId);
    const challenge = await hydrateChallengeFromMinio(base);
    const pub = publicSession(session, challenge, req.user);
    res.status(created ? 201 : 200).json({
      sessionId: session.id,
      created,
      status: session.status,
      runtime: 'board',
      session: pub,
      challenge: pub.challenge,
    });
  } catch (e) {
    sendStartError(e, res, next);
  }
});

// POST /api/session/k8s/start  { challengeId }
router.post('/k8s/start', requireSessionAccess, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const body = (req.body as Record<string, unknown>) || {};
    const challengeId = body.challengeId as string;
    const user = req.user as { sub?: string; id?: string; email?: string } | undefined;
    const userId = user?.sub || user?.id || null;
    const email = String(user?.email || '').trim().toLowerCase();
    const userName = email.includes('@')
      ? email.slice(0, email.indexOf('@'))
      : (email || null);

    assertChallengeAccess(req, challengeId);
    const clientId = await claimLabSlot(req, challengeId, userId);

    const { session, created, provisioned } = await k8sLifecycle.startK8sSession({
      challengeId,
      userId,
      candidateName: null,
      userName,
    });
    sessionExclusivity.heartbeat(session.id, clientId, true);

    const base = loader.getPublicChallenge(challengeId) || loader.getChallenge(challengeId);
    const challenge = await hydrateChallengeFromMinio(base);
    const pub = publicSession(session, challenge, req.user);
    res.status(created ? 201 : 200).json({
      sessionId: session.id,
      created,
      provisioned,
      status: session.status,
      runtime: 'kubernetes',
      k8sNamespace: session.k8sNamespace || session.workspacePrefix,
      terminalWsUrl: `ws://${BACKEND_HOST}/ws/k8s-terminal?sessionId=${session.id}`,
      session: pub,
      challenge: pub.challenge,
    });
  } catch (e) {
    sendStartError(e, res, next);
  }
});

// GET /api/session/k8s/capacity — the learner's pods waiting for a node (also while
// /k8s/start is still in flight, before the client has a session id).
router.get('/k8s/capacity', requireSessionAccess, (req: ExpressRequest, res: ExpressResponse) => {
  const user = req.user as { sub?: string; id?: string; email?: string } | undefined;
  const email = String(user?.email || '').trim().toLowerCase();
  const userName = email.includes('@') ? email.slice(0, email.indexOf('@')) : (email || null);
  const ns = k8sLifecycle.namespaceFor(user?.sub || user?.id || null, userName);
  res.json({ waiting: k8sCapacity.waitingPods(ns), reservingSeconds: k8sCapacity.reservingSeconds(ns) });
});

// GET /api/session/k8s/availability?challengeId= — whether the lab's node pool is up,
// so the client can open a locked lab (description only) without starting a session.
router.get('/k8s/availability', requireSessionAccess, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const challengeId = String(req.query.challengeId || '');
    assertChallengeAccess(req, challengeId);
    res.json(await k8sLifecycle.labAvailability(challengeId));
  } catch (e) {
    next(e);
  }
});

router.post('/:id/k8s/reset', requireSessionAccess, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getK8sSession(req.params.id, res);
    if (!session) return;
    await k8sLifecycle.resetK8sSession(session.id);
    res.json({
      sessionId: session.id,
      k8sNamespace: session.k8sNamespace || session.workspacePrefix,
      reset: true,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/k8s/grade', requireSessionAccess, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getK8sSession(req.params.id, res);
    if (!session) return;
    const ns = String(session.k8sNamespace || session.workspacePrefix);
    const challengeId = String(session.challengeId || '');
    if (loader.getChallenge(challengeId)?.k8sPlatform?.practice) {
      return res.status(400).json({ error: 'This is a practice lab: there is nothing to submit.' });
    }
    const result = await k8sGrade.gradeK8sSession(ns, challengeId);
    const submission = await k8sGrade.recordK8sSubmission(session, result);
    res.json({
      sessionId: session.id,
      challengeId,
      k8sNamespace: ns,
      submissionId: submission.id,
      submission,
      ...result,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/k8s/submissions', requireSessionAccess, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getK8sSession(req.params.id, res);
    if (!session) return;
    const submissions = await k8sGrade.listK8sSubmissionsForSession(session.id);
    res.json({ sessionId: session.id, submissions });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/k8s/exec', requireSessionAccess, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getKubectlLabSession(req.params.id, res);
    if (!session) return;
    const ns = String(session.k8sNamespace || session.workspacePrefix);
    const body = (req.body as Record<string, unknown>) || {};
    let args: string[] = [];
    if (Array.isArray(body.args)) {
      args = body.args.map((a) => String(a));
    } else if (typeof body.command === 'string') {
      const raw = body.command.trim();
      const stripped = raw.replace(/^kubectl\s+/i, '');
      args = stripped ? stripped.split(/\s+/) : [];
    }
    const result = await k8sCluster.learnerKubectl(ns, args, {
      challengeId: session.challengeId,
    });
    res.status(result.code === 0 ? 200 : 400).json({
      sessionId: session.id,
      k8sNamespace: ns,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (e) {
    next(e);
  }
});

function sendLabFileError(e: unknown, res: ExpressResponse, next: ExpressNextFunction): void {
  if (e instanceof k8sLabFiles.LabFileError) {
    res.status((e as { status: number }).status).json({ error: (e as Error).message });
    return;
  }
  next(e);
}

// Editor files in the learner's lab home (the terminal's working directory).
type LabFilesHandler = (ns: string, req: ExpressRequest) => unknown;

function labFilesRoute(handler: LabFilesHandler, opts: { touch?: boolean } = {}) {
  return (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void => {
    try {
      const session = getKubectlLabSession(req.params.id, res);
      if (!session) return;
      if (opts.touch) sessionIdle.touch(session.id);
      res.json(handler(String(session.k8sNamespace || session.workspacePrefix), req));
    } catch (e) {
      sendLabFileError(e, res, next);
    }
  };
}

function bodyOf(req: ExpressRequest): Record<string, unknown> {
  return (req.body as Record<string, unknown>) || {};
}

router.get('/:id/k8s/files', requireSessionAccess, labFilesRoute(
  (ns, req) => k8sLabFiles.listDir(ns, req.query.dir),
));

router.get('/:id/k8s/folders', requireSessionAccess, labFilesRoute(
  (ns) => ({ folders: k8sLabFiles.listAllFolders(ns) }),
));

router.post('/:id/k8s/folders', requireSessionAccess, express.json({ limit: '16kb' }), labFilesRoute(
  (ns, req) => ({ path: k8sLabFiles.createFolder(ns, bodyOf(req).path) }),
  { touch: true },
));

router.get('/:id/k8s/file', requireSessionAccess, labFilesRoute(
  (ns, req) => k8sLabFiles.readFile(ns, req.query.path),
));

router.put('/:id/k8s/file', requireSessionAccess, express.json({ limit: '512kb' }), labFilesRoute(
  (ns, req) => ({ file: k8sLabFiles.writeFile(ns, bodyOf(req).path, bodyOf(req).content) }),
  { touch: true },
));

router.post('/:id/k8s/files/rename', requireSessionAccess, express.json({ limit: '16kb' }), labFilesRoute(
  (ns, req) => k8sLabFiles.renameEntry(ns, bodyOf(req).from, bodyOf(req).to),
  { touch: true },
));

router.delete('/:id/k8s/folders', requireSessionAccess, labFilesRoute(
  (ns, req) => {
    k8sLabFiles.deleteFolder(ns, req.query.path);
    return { ok: true };
  },
  { touch: true },
));

router.delete('/:id/k8s/file', requireSessionAccess, labFilesRoute(
  (ns, req) => {
    k8sLabFiles.deleteFile(ns, req.query.path);
    return { ok: true };
  },
  { touch: true },
));

router.get('/:id/board', requireSessionAccess, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getBoardSession(req.params.id, res);
    if (!session) return;
    const challenge = session.challengeId ? loader.getChallenge(session.challengeId) : null;
    const spec = boardLifecycle.specFromChallenge(challenge);
    const boardState = spec
      ? boardLifecycle.coerceBoardState(session.boardState, spec)
      : session.boardState || null;
    res.json({
      sessionId: session.id,
      boardState,
      updatedAt: session.workspaceUpdatedAt || null,
    });
  } catch (e) {
    next(e);
  }
});

router.put('/:id/board', requireSessionAccess, express.json({ limit: '256kb' }), async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getBoardSession(req.params.id, res);
    if (!session) return;
    const challenge = session.challengeId ? loader.getChallenge(session.challengeId) : null;
    const spec = boardLifecycle.specFromChallenge(challenge);
    if (!spec) return res.status(500).json({ error: 'board spec missing' });
    const body = (req.body as Record<string, unknown>) || {};
    const state = boardLifecycle.savePlaced(session, spec, body);
    session.status = 'active';
    session.endTime = null;
    await sessionStore.persistRow(session);
    res.json({ ok: true, boardState: state, updatedAt: session.workspaceUpdatedAt || null });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/board/submit', requireSessionAccess, express.json({ limit: '256kb' }), async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getBoardSession(req.params.id, res);
    if (!session) return;
    const challenge = session.challengeId ? loader.getChallenge(session.challengeId) : null;
    const spec = boardLifecycle.specFromChallenge(challenge);
    if (!spec) return res.status(500).json({ error: 'board spec missing' });
    const body = (req.body as Record<string, unknown>) || {};
    session.status = 'active';
    session.endTime = null;
    const { state, grade } = await boardLifecycle.submitBoard(session, spec, body);
    res.json({
      ok: true,
      passed: grade.passed,
      grade,
      boardState: state,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/session/:id/workspace
router.get('/:id/workspace', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getSparkSession(req.params.id, res);
    if (!session) return;
    const files = await workspaceStore.loadAllFiles(session.id, session.workspacePrefix);
    const manifest = await workspaceStore.listFiles(session.id);
    res.json({
      sessionId: session.id,
      workspacePrefix: session.workspacePrefix,
      entrypoint: session.entrypoint,
      files,
      manifest,
      updatedAt: session.workspaceUpdatedAt || null,
    });
  } catch (e) {
    next(e);
  }
});

// PUT /api/session/:id/workspace/file  { path, content }
router.put('/:id/workspace/file', express.json({ limit: '2mb' }), async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getSparkSession(req.params.id, res);
    if (!session) return;
    const body = (req.body as Record<string, unknown>) || {};
    const filePath = safeWorkspacePath(body.path);
    if (!filePath) return res.status(400).json({ error: 'invalid path' });
    if (typeof body.content !== 'string') return res.status(400).json({ error: 'content must be a string' });

    const result = await workspaceStore.putFile(
      session.id,
      session.workspacePrefix,
      filePath,
      body.content,
    );
    session.workspaceUpdatedAt = Date.now();
    await sessionStore.persistRow(session);
    res.json({ ok: true, ...result, updatedAt: session.workspaceUpdatedAt });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/session/:id/workspace/file  { path }
router.delete('/:id/workspace/file', express.json({ limit: '1mb' }), async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getSparkSession(req.params.id, res);
    if (!session) return;
    const body = (req.body as Record<string, unknown>) || {};
    const filePath = safeWorkspacePath(body.path || req.query.path);
    if (!filePath) return res.status(400).json({ error: 'invalid path' });

    await workspaceStore.deleteFile(session.id, session.workspacePrefix, filePath);
    session.workspaceUpdatedAt = Date.now();
    await sessionStore.persistRow(session);
    res.json({ ok: true, path: filePath });
  } catch (e) {
    next(e);
  }
});

// POST /api/session/:id/workspace/rename  { from, to }
router.post('/:id/workspace/rename', express.json({ limit: '1mb' }), async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getSparkSession(req.params.id, res);
    if (!session) return;
    const body = (req.body as Record<string, unknown>) || {};
    const from = safeWorkspacePath(body.from);
    const to = safeWorkspacePath(body.to);
    if (!from || !to) return res.status(400).json({ error: 'invalid from/to path' });

    await workspaceStore.renameFile(session.id, session.workspacePrefix, from, to);
    session.workspaceUpdatedAt = Date.now();
    await sessionStore.persistRow(session);
    res.json({ ok: true, from, to });
  } catch (e) {
    next(e);
  }
});

// POST /api/session/:id/workspace/reset  { starterFiles? }
// Restore published starter (MinIO challenges/<id>/starter/, or starterFiles for playground / legacy).
router.post('/:id/workspace/reset', express.json({ limit: '2mb' }), async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getSparkSession(req.params.id, res);
    if (!session) return;
    const body = (req.body as Record<string, unknown>) || {};
    const starterFiles = parseStarterFiles(body.starterFiles);
    const result = await sparkLifecycle.resetWorkspace(session, starterFiles);
    res.json({
      ok: true,
      sessionId: session.id,
      entrypoint: result.entrypoint,
      files: result.files,
      updatedAt: session.workspaceUpdatedAt || null,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/session/:id/spark/jobs  { mode, inputPath, businessDate, evalSolutionPath?, limits? }
router.post('/:id/spark/jobs', express.json({ limit: '256kb' }), async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getSparkSession(req.params.id, res);
    if (!session) return;
    const body = (req.body as Record<string, unknown>) || {};
    const mode = body.mode === 'run' ? 'run' : 'submit';
    const inputPath = typeof body.inputPath === 'string' ? body.inputPath : '';
    const businessDate = typeof body.businessDate === 'string' ? body.businessDate : '2026-01-15';
    const evalSolutionPath =
      typeof body.evalSolutionPath === 'string'
        ? body.evalSolutionPath
        : typeof body.resultsPath === 'string'
          ? body.resultsPath
          : '';
    const testcasesPrefix =
      typeof body.testcasesPrefix === 'string' ? body.testcasesPrefix : undefined;
    const cases = Array.isArray(body.cases)
      ? body.cases.map((c) => String(c)).filter(Boolean)
      : undefined;
    const gradeKeys = Array.isArray(body.gradeKeys)
      ? body.gradeKeys.map((c) => String(c)).filter(Boolean)
      : undefined;
    const outputFormat =
      body.outputFormat === 'parquet' || body.outputFormat === 'json' || body.outputFormat === 'csv'
        ? body.outputFormat
        : undefined;
    const productsPath =
      typeof body.productsPath === 'string' ? body.productsPath : undefined;
    const dimPath =
      typeof body.dimPath === 'string' ? body.dimPath : undefined;
    const txnInputPath =
      typeof body.txnInputPath === 'string' ? body.txnInputPath : undefined;
    const rateInputPath =
      typeof body.rateInputPath === 'string' ? body.rateInputPath : undefined;
    const eventsInputPath =
      typeof body.eventsInputPath === 'string' ? body.eventsInputPath : undefined;
    const catalogInputPath =
      typeof body.catalogInputPath === 'string' ? body.catalogInputPath : undefined;
    const gradeScript =
      typeof body.gradeScript === 'string' ? body.gradeScript : undefined;
    const dualInput = body.dualInput === true;
    const limits = (body.limits && typeof body.limits === 'object')
      ? (body.limits as Record<string, unknown>)
      : undefined;
    const sparkKnobs = parseSparkKnobs(body.sparkKnobs);
    const fallbackEntry = session.entrypoint || 'src/main.py';
    const entrypoint = typeof body.entrypoint === 'string' && body.entrypoint.trim()
      ? body.entrypoint.trim()
      : fallbackEntry;
    if (entrypoint !== session.entrypoint) {
      session.entrypoint = entrypoint;
      await sessionStore.persistRow(session);
    }

    const job = await sparkJobs.startSparkJob({
      session: {
        id: session.id,
        challengeId: session.challengeId,
        userId: session.userId || null,
        workspacePrefix: session.workspacePrefix,
        entrypoint,
      },
      mode,
      inputPath: inputPath || undefined,
      businessDate,
      evalSolutionPath: evalSolutionPath || undefined,
      testcasesPrefix,
      cases,
      gradeKeys,
      outputFormat,
      productsPath: productsPath || undefined,
      dimPath: dimPath || undefined,
      txnInputPath: txnInputPath || undefined,
      rateInputPath: rateInputPath || undefined,
      eventsInputPath: eventsInputPath || undefined,
      catalogInputPath: catalogInputPath || undefined,
      gradeScript: gradeScript || undefined,
      dualInput,
      limits: limits as {
        driver?: number;
        driverMemory?: string;
        executors?: number;
        executorCores?: number;
        executorMemory?: string;
        aqe?: boolean;
        shufflePartitions?: number;
        skewJoin?: boolean;
        autoBroadcastJoinThreshold?: string;
      } | undefined,
      sparkKnobs,
      entrypoint,
    });
    res.status(201).json({ job });
  } catch (e) {
    next(e);
  }
});

// GET /api/session/:id/spark/jobs
router.get('/:id/spark/jobs', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getSparkSession(req.params.id, res);
    if (!session) return;
    const jobs = await sparkJobs.listJobsForSession(session.id);
    res.json({ jobs });
  } catch (e) {
    next(e);
  }
});

// GET /api/session/:id/spark/submissions  (scored submit-mode jobs only)
router.get('/:id/spark/submissions', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getSparkSession(req.params.id, res);
    if (!session) return;
    const submissions = await sparkJobs.listSubmissionsForSession(session.id);
    res.json({ submissions });
  } catch (e) {
    next(e);
  }
});

// GET /api/session/:id/spark/jobs/:jobId/files  (frozen submit/run snapshot)
router.get('/:id/spark/jobs/:jobId/files', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getSparkSession(req.params.id, res);
    if (!session) return;
    const payload = await sparkJobs.listJobAppFiles(req.params.jobId, session.id);
    res.json(payload);
  } catch (e) {
    next(e);
  }
});

// GET /api/session/:id/spark/jobs/:jobId
router.get('/:id/spark/jobs/:jobId', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getSparkSession(req.params.id, res);
    if (!session) return;
    const job = await sparkJobs.refreshJobFromPlatform(req.params.jobId);
    if (!job?.id || job.sessionId !== session.id) {
      return res.status(404).json({ error: 'job not found' });
    }
    res.json({ job });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/session/:id/spark/jobs/:jobId  — kill a running Run/Submit
router.delete('/:id/spark/jobs/:jobId', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session = getSparkSession(req.params.id, res);
    if (!session) return;
    const job = await sparkJobs.killSparkJob(req.params.jobId, session.id);
    res.json({ job });
  } catch (e) {
    next(e);
  }
});

function browseMount(req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void {
  const m = req.path.match(/^\/([^/]+)\/browse\/([^/]+)(.*)$/);
  if (!m) { next(); return; }
  req.params.id = m[1];
  req.params.service = m[2];
  Promise.resolve(handleBrowse(req, res)).catch(next);
}

router.use(browseMount);

router.get('/:id/browse-services', (req: ExpressRequest, res: ExpressResponse) => {
  const session = sessionStore.get(req.params.id);
  if (!session || session.status !== 'active') {
    return res.status(404).json({ error: 'session not found or sandbox not running' });
  }
  res.json({ services: listBrowseServices(session.portMap) });
});

// POST /api/session/:id/heartbeat  { clientId, force? } — keeps this tab's claim on the lab.
router.post('/:id/heartbeat', express.json({ limit: '4kb' }), (req: ExpressRequest, res: ExpressResponse) => {
  const session: GameSession | null = sessionStore.get(req.params.id);
  if (!session || session.status !== 'active') {
    return res.status(410).json({ error: 'session is not active', code: 'SESSION_ENDED' });
  }
  const body = (req.body as Record<string, unknown>) || {};
  const ok = sessionExclusivity.heartbeat(session.id, clientIdFrom(body), body.force === true);
  if (!ok) {
    return res.status(409).json({
      error: 'This lab is open in another tab or window.',
      code: 'LAB_OPEN_IN_OTHER_TAB',
    });
  }
  res.json({ ok: true, leaseTtlMs: sessionExclusivity.LEASE_TTL_MS });
});

// POST /api/session/:id/lease/release  { clientId } — sent via sendBeacon on tab close/reload.
router.post('/:id/lease/release', express.text({ type: '*/*', limit: '4kb' }), (req: ExpressRequest, res: ExpressResponse) => {
  let body: Record<string, unknown> = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : ((req.body as Record<string, unknown>) || {});
  } catch {
    body = {};
  }
  const clientId = clientIdFrom(body);
  if (clientId) sessionExclusivity.release(req.params.id, clientId);
  res.status(204).end();
});

router.get('/:id', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const session: GameSession | null = sessionStore.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found' });
    const base = session.challengeId
      ? (loader.getPublicChallenge(session.challengeId) || loader.getChallenge(session.challengeId))
      : null;
    const challenge = await hydrateChallengeFromMinio(base);
    res.json({ session: publicSession(session, challenge, req.user) });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/end', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const sessionId = req.params.id;
    const before: GameSession | null = sessionStore.get(sessionId);
    if (!before) return res.status(404).json({ error: 'session not found' });

    let session: GameSession;
    if (before.runtime === 'spark-platform') {
      session = await sparkLifecycle.endSparkSession(sessionId);
    } else if (before.runtime === 'board') {
      session = await boardLifecycle.endBoardSession(sessionId);
    } else if (before.runtime === 'kubernetes') {
      session = await k8sLifecycle.endK8sSession(sessionId);
    } else {
      session = await lifecycle.end(sessionId);
      await sessionStore.persistRow(session);
    }

    terminalEventBus.emit('session_end', { sessionId });
    sessionExclusivity.release(sessionId);

    res.json({
      sessionId,
      elapsed: (session.endTime || Date.now()) - session.startTime,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
