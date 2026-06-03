'use strict';

const express = require('express');
const { spawn } = require('child_process');
const { requireSessionAccess } = require('../auth/middleware');
const lifecycle = require('../sandbox/sessionLifecycle');
const sessionStore = require('../db/sessionStore');
const loader = require('../challenges/loader');
const scoringEngine = require('../scoring/scoringEngine');
const terminalEventBus = require('../observability/terminalEventBus');
const { handleBrowse, listBrowseServices } = require('../sandbox/sessionBrowseProxy');

const router = express.Router();

// Reject any path containing ".." segments to prevent path traversal.
function safePath(p) {
  if (!p || typeof p !== 'string') return null;
  const parts = p.split('/');
  if (parts.some((seg) => seg === '..')) return null;
  return p.startsWith('/') ? p : `/${p}`;
}

function getSession(id, res) {
  const session = sessionStore.get(id);
  if (!session) { res.status(404).json({ error: 'session not found' }); return null; }
  if (!session.buildDir) { res.status(409).json({ error: 'sandbox not running' }); return null; }
  return session;
}

// GET /api/session/:id/file?path=<abs-path>&container=<service>
router.get('/:id/file', async (req, res) => {
  const session = getSession(req.params.id, res);
  if (!session) return;

  const filePath = safePath(req.query.path);
  if (!filePath) return res.status(400).json({ error: 'invalid path' });

  const container = req.query.container || session.terminalService || (session.services || [])[0];
  if (!container) return res.status(400).json({ error: 'no container specified' });

  const child = spawn(
    'docker',
    ['compose', 'exec', '-T', container, 'cat', filePath],
    { cwd: session.buildDir, env: process.env },
  );

  let content = '';
  let stderr = '';
  child.stdout.on('data', (d) => { content += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('error', (err) => res.status(500).json({ error: err.message }));
  child.on('close', (code) => {
    if (code !== 0) {
      return res.status(404).json({ error: `file not found or unreadable: ${stderr.trim()}` });
    }
    res.json({ path: filePath, container, content });
  });
});

// POST /api/session/:id/file  { path, content, container }
router.post('/:id/file', express.json({ limit: '2mb' }), async (req, res) => {
  const session = getSession(req.params.id, res);
  if (!session) return;

  const filePath = safePath(req.body?.path);
  if (!filePath) return res.status(400).json({ error: 'invalid path' });

  const { content = '', container: reqContainer } = req.body || {};
  const container = reqContainer || session.terminalService || (session.services || [])[0];
  if (!container) return res.status(400).json({ error: 'no container specified' });

  // Use `tee` to write content from stdin into the file inside the container.
  const child = spawn(
    'docker',
    ['compose', 'exec', '-T', container, 'sh', '-c', `tee '${filePath}' > /dev/null`],
    { cwd: session.buildDir, env: process.env },
  );

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('error', (err) => res.status(500).json({ error: err.message }));
  child.on('close', (code) => {
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

function isHiddenService(name) {
  return HIDDEN_SERVICE_PATTERNS.some((re) => re.test(name));
}

function candidateServices(allServices) {
  const list = Array.isArray(allServices) && allServices.length > 0
    ? allServices
    : [];
  const visible = list.filter((s) => !isHiddenService(s));
  return visible.length > 0 ? visible : list; // fallback: show all if everything was filtered
}

function publicSession(s, challenge) {
  return {
    id: s.id,
    status: s.status,
    challengeId: s.challengeId,
    candidateName: s.candidateName,
    startTime: s.startTime,
    endTime: s.endTime,
    score: s.score,
    recovered: s.recovered,
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
          id: challenge.id,
          title: challenge.title,
          description: challenge.description,
          difficulty: challenge.difficulty,
          tags: challenge.tags,
          category: challenge.category,
          problemStatement: challenge.problemStatement,
        }
      : null,
  };
}

router.post('/start', requireSessionAccess, async (req, res, next) => {
  try {
    const { challengeId, candidateToken } = req.body || {};
    const { session, challenge } = await lifecycle.start({ challengeId, candidateToken });

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

function browseMount(req, res, next) {
  const m = req.path.match(/^\/([^/]+)\/browse\/([^/]+)(.*)$/);
  if (!m) return next();
  req.params.id = m[1];
  req.params.service = m[2];
  Promise.resolve(handleBrowse(req, res)).catch(next);
}

router.use(browseMount);

router.get('/:id/browse-services', (req, res) => {
  const session = sessionStore.get(req.params.id);
  if (!session || session.status !== 'active') {
    return res.status(404).json({ error: 'session not found or sandbox not running' });
  }
  res.json({ services: listBrowseServices(session.portMap) });
});

router.get('/:id', (req, res) => {
  const session = sessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const challenge = session.challengeId ? loader.getChallenge(session.challengeId) : null;
  res.json({ session: publicSession(session, challenge) });
});

router.post('/:id/end', async (req, res, next) => {
  try {
    const sessionId = req.params.id;
    const before = sessionStore.get(sessionId);
    if (!before) return res.status(404).json({ error: 'session not found' });

    const challenge = before.challengeId ? loader.getChallenge(before.challengeId) : null;

    let evaluation = { passed: false, feedback: 'no validation spec' };
    let validationEvents = [];
    if (challenge && challenge.validationSpec) {
      const result = await scoringEngine.runValidation(before, challenge);
      evaluation = result.evaluation;
      validationEvents = result.events;
    }

    for (const ev of validationEvents) {
      await sessionStore.persistEvent(sessionId, ev.type, ev.data || null);
    }

    const session = await lifecycle.end(sessionId);

    const events = await sessionStore.loadEvents(sessionId);
    const { score, breakdown } = scoringEngine.computeScore({
      session,
      events,
    });
    session.score = score;
    sessionStore.set(sessionId, session);
    await sessionStore.persistRow(session);

    terminalEventBus.emit('session_end', { sessionId, evaluation });

    res.json({
      sessionId,
      score,
      elapsed: (session.endTime || Date.now()) - session.startTime,
      events,
      evaluation,
      breakdown,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
