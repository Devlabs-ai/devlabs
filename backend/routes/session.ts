'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';
import type { GameSession } from '../types/domain';

const express = require('express');
const { spawn } = require('child_process');
const { requireSessionAccess } = require('../auth/middleware');
const lifecycle = require('../sandbox/sessionLifecycle');
const sparkLifecycle = require('../workspace/sparkLifecycle');
const sparkJobs = require('../workspace/sparkJobs');
const workspaceStore = require('../workspace/workspaceStore');
const sessionStore = require('../db/sessionStore');
const loader = require('../challenges/loader');
const terminalEventBus = require('../observability/terminalEventBus');
const { handleBrowse, listBrowseServices } = require('../sandbox/sessionBrowseProxy');

const router = express.Router();

/** Relative workspace path (no leading slash, no ..). */
function safeWorkspacePath(p: unknown): string | null {
  if (!p || typeof p !== 'string') return null;
  const trimmed = p.replace(/^\/+/, '');
  if (!trimmed || trimmed.includes('..') || trimmed.includes('\\')) return null;
  return trimmed;
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

function publicSession(s: GameSession, challenge: unknown): Record<string, unknown> {
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
    entrypoint: s.entrypoint || null,
    workspaceUpdatedAt: s.workspaceUpdatedAt || null,
    services: candidateServices(
      Array.isArray(s.services) && s.services.length > 0
        ? s.services
        : Object.keys(s.portMap || {}),
    ),
    portMap: s.portMap,
    metricsService: s.metricsService,
    terminalService: s.terminalService,
    challenge: challenge
      ? {
          id: (challenge as Record<string, unknown>).id,
          title: (challenge as Record<string, unknown>).title,
          description: (challenge as Record<string, unknown>).description,
          difficulty: (challenge as Record<string, unknown>).difficulty,
          tags: (challenge as Record<string, unknown>).tags,
          category: (challenge as Record<string, unknown>).category,
          sandboxType: (challenge as Record<string, unknown>).sandboxType,
          problemStatement: (challenge as Record<string, unknown>).problemStatement,
        }
      : null,
  };
}

router.post('/start', requireSessionAccess, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const body = (req.body as Record<string, unknown>) || {};
    const { challengeId } = body;
    const { session, challenge } = await lifecycle.start({ challengeId });

    const pub = publicSession(session, challenge);
    res.status(201).json({
      sessionId: session.id,
      status: session.status,
      terminalWsUrl: `ws://${BACKEND_HOST}/ws/terminal?sessionId=${session.id}`,
      metricsWsUrl: `ws://${BACKEND_HOST}/ws/metrics?sessionId=${session.id}`,
      agentObserverWsUrl: `ws://${BACKEND_HOST}/ws/agent-observer?sessionId=${session.id}`,
      services: pub.services,
      terminalService: pub.terminalService,
      challenge: pub.challenge,
      session: pub,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/session/spark/start  { challengeId, starterFiles, entrypoint? }
router.post('/spark/start', requireSessionAccess, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const body = (req.body as Record<string, unknown>) || {};
    const challengeId = body.challengeId as string;
    const starterFiles = body.starterFiles as Record<string, string>;
    const entrypoint = (body.entrypoint as string) || 'src/main.py';
    const userId = (req.user as { sub?: string; id?: string } | undefined)?.sub
      || (req.user as { sub?: string; id?: string } | undefined)?.id
      || null;

    const { session, created } = await sparkLifecycle.startSparkSession({
      challengeId,
      userId,
      candidateName: null,
      entrypoint,
      starterFiles,
    });

    const challenge = loader.getChallenge(challengeId);
    const pub = publicSession(session, challenge);
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
    const limits = (body.limits && typeof body.limits === 'object')
      ? (body.limits as Record<string, unknown>)
      : undefined;

    const job = await sparkJobs.startSparkJob({
      session: {
        id: session.id,
        challengeId: session.challengeId,
        userId: session.userId || null,
        workspacePrefix: session.workspacePrefix,
        entrypoint: session.entrypoint || 'src/main.py',
      },
      mode,
      inputPath,
      businessDate,
      evalSolutionPath: evalSolutionPath || undefined,
      limits: limits as {
        driver?: number;
        executors?: number;
        executorCores?: number;
        executorMemory?: string;
      } | undefined,
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

router.get('/:id', (req: ExpressRequest, res: ExpressResponse) => {
  const session: GameSession | null = sessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const challenge = session.challengeId ? loader.getChallenge(session.challengeId) : null;
  res.json({ session: publicSession(session, challenge) });
});

router.post('/:id/end', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const sessionId = req.params.id;
    const before: GameSession | null = sessionStore.get(sessionId);
    if (!before) return res.status(404).json({ error: 'session not found' });

    let session: GameSession;
    if (before.runtime === 'spark-platform') {
      session = await sparkLifecycle.endSparkSession(sessionId);
    } else {
      session = await lifecycle.end(sessionId);
      await sessionStore.persistRow(session);
    }

    terminalEventBus.emit('session_end', { sessionId });

    res.json({
      sessionId,
      elapsed: (session.endTime || Date.now()) - session.startTime,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
