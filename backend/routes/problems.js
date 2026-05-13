'use strict';

const express = require('express');

const { requireInterviewer } = require('../auth/middleware');
const draftStore = require('../problems/problemDraftStore');
const reviewStore = require('../problems/reviewStore');
const problemAgent = require('../problems/problemAgentService');
const buildAgent = require('../problems/buildAgentService');
const { promote } = require('../problems/promoteToVerified');
const llm = require('../llm/client');

const router = express.Router();

const PORT = parseInt(process.env.PORT || '4000', 10);
const BACKEND_HOST = `localhost:${PORT}`;
const TERMINAL_WS_BASE = `ws://${BACKEND_HOST}`;

router.use(requireInterviewer);

// --- SSE helpers ---------------------------------------------------------

function openSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': sse-connected\n\n');
  return (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (_e) { /* client disconnected */ }
  };
}

function publicDraft(d) {
  if (!d) return null;
  return {
    id: d.id,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    messages: d.messages,
    draft: d.draft,
    buildStatus: d.buildStatus,
    buildSessionId: d.buildSessionId,
    buildDir: d.buildDir,
    buildAttempts: d.buildAttempts,
    buildLogs: d.buildLogs,
    builtChallenge: d.builtChallenge,
    buildValidation: d.buildValidation,
    buildCurrentPhase: d.buildCurrentPhase,
    buildCurrentAttempt: d.buildCurrentAttempt,
  };
}

// --- LLM config introspection -------------------------------------------

router.get('/config', (_req, res) => {
  res.json({
    llmConfigured: llm.isConfigured(),
    provider: llm.getProvider(),
    model: llm.isConfigured() ? llm.getModel() : null,
    maxIterations: buildAgent.MAX_ITERATIONS,
  });
});

// --- draft session CRUD --------------------------------------------------

router.get('/', (_req, res) => {
  res.json({ drafts: draftStore.list().map(publicDraft) });
});

router.post('/session', async (_req, res, next) => {
  try {
    const d = draftStore.makeDraft();
    draftStore.set(d.id, d);
    await draftStore.persist(d);
    res.status(201).json({ sessionId: d.id, draft: publicDraft(d) });
  } catch (e) { next(e); }
});

router.post('/import-draft', async (req, res, next) => {
  try {
    const { draft } = req.body || {};
    if (!draft || typeof draft !== 'object') {
      return res.status(400).json({ error: 'body must contain { draft: { ... } }' });
    }
    const d = draftStore.makeDraft({ draft });
    d.messages.push({
      role: 'assistant',
      content: 'Imported a draft directly. You can iterate on it in chat or trigger a build.',
    });
    draftStore.set(d.id, d);
    await draftStore.persist(d);
    res.status(201).json({ sessionId: d.id, draft: publicDraft(d) });
  } catch (e) { next(e); }
});

router.get('/:sessionId', (req, res) => {
  const d = draftStore.get(req.params.sessionId);
  if (!d) return res.status(404).json({ error: 'draft session not found' });
  res.json({ draft: publicDraft(d) });
});

router.delete('/:sessionId', async (req, res, next) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (d && d.buildDir) {
      await buildAgent.teardownBuild(d.id, d.buildDir).catch(() => {});
    }
    await draftStore.remove(req.params.sessionId);
    await reviewStore.remove(req.params.sessionId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- chat (SSE) ----------------------------------------------------------

router.post('/:sessionId/chat', async (req, res) => {
  const d = draftStore.get(req.params.sessionId);
  if (!d) return res.status(404).json({ error: 'draft session not found' });
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'body must contain { message: "..." }' });
  }

  d.messages.push({ role: 'user', content: message });
  draftStore.set(d.id, d);

  const send = openSse(res);
  let assistantText = '';

  try {
    const { draft } = await problemAgent.streamChatTurn({
      messages: d.messages.map((m) => ({ role: m.role, content: m.content })),
      onEvent: (ev) => {
        if (ev.type === 'text') assistantText += ev.delta;
        send(ev);
      },
    });

    d.messages.push({ role: 'assistant', content: assistantText });
    if (draft) d.draft = draft;
    draftStore.set(d.id, d);
    await draftStore.persist(d);
  } catch (e) {
    console.warn('[problems/chat] error:', e.message);
    send({ type: 'error', message: e.message, code: e.code || null });
  } finally {
    try { res.end(); } catch (_e) { /* noop */ }
  }
});

// --- build (SSE) ---------------------------------------------------------

router.post('/:sessionId/build', async (req, res) => {
  const d = draftStore.get(req.params.sessionId);
  if (!d) return res.status(404).json({ error: 'draft session not found' });
  if (!d.draft) {
    return res.status(400).json({ error: 'no draft on this session; finish the chat or import a draft first' });
  }

  const send = openSse(res);

  d.buildStatus = 'building';
  d.buildAttempts = 0;
  d.buildLogs = [];
  d.buildCurrentPhase = null;
  d.buildCurrentAttempt = 0;
  draftStore.set(d.id, d);
  await draftStore.snapshotBuildState(d);
  await draftStore.persist(d).catch(() => {});

  const onEvent = (ev) => {
    if (ev.type === 'log' && ev.message) {
      d.buildLogs.push(ev.message);
      if (d.buildLogs.length > 1000) d.buildLogs.splice(0, d.buildLogs.length - 1000);
    }
    if (ev.type === 'phase') {
      d.buildCurrentPhase = ev.phase;
      d.buildCurrentAttempt = ev.attempt;
      d.buildAttempts = Math.max(d.buildAttempts, ev.attempt);
    }
    if (ev.type === 'buildDir') {
      d.buildDir = ev.buildDir;
    }
    draftStore.set(d.id, d);
    draftStore.snapshotBuildState(d).catch(() => {});
    send(ev);
  };

  try {
    const result = await buildAgent.runBuildLoop({
      draft: d.draft,
      draftSessionId: d.id,
      onEvent,
      terminalWsBase: TERMINAL_WS_BASE,
    });

    d.buildSessionId = result.buildSessionId;
    d.buildDir = result.buildDir;
    d.builtChallenge = result.builtChallenge;
    d.buildValidation = result.buildValidation;
    d.buildStatus = 'review_ready';
    draftStore.set(d.id, d);
    await draftStore.persist(d).catch(() => {});

    await reviewStore.upsert({
      draftSessionId: d.id,
      title: result.builtChallenge.title || d.draft?.title || 'Untitled draft',
      builtChallenge: result.builtChallenge,
      buildValidation: result.buildValidation,
      buildDir: result.buildDir,
    });
  } catch (e) {
    d.buildStatus = 'failed';
    draftStore.set(d.id, d);
    await draftStore.persist(d).catch(() => {});
    send({ type: 'error', message: e.message, code: e.code || null, lastFailure: e.lastFailure || null });
  } finally {
    try { res.end(); } catch (_e) { /* noop */ }
  }
});

// --- promote build to sandbox/verified ----------------------------------

router.post('/:sessionId/push-to-sandbox', async (req, res, next) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });
    const result = await promote({
      buildDir: d.buildDir,
      builtChallenge: d.builtChallenge,
      fallbackTitle: d.draft?.title || d.id,
    });

    // teardown the build's compose stack now that we've copied it; if the
    // interviewer wants to playtest, they start a fresh session.
    if (d.buildDir) {
      await buildAgent.teardownBuild(d.id, d.buildDir).catch(() => {});
      d.buildDir = null;
    }
    d.buildStatus = null;
    draftStore.set(d.id, d);
    await draftStore.persist(d).catch(() => {});
    await reviewStore.remove(d.id);

    res.json({
      ok: true,
      slug: result.slug,
      verifiedDir: result.verifiedDir,
      challenge: result.challenge,
    });
  } catch (e) { next(e); }
});

// alias kept for backwards-compat per the original spec
router.post('/:sessionId/finalize', (req, res, next) => {
  req.url = `/${req.params.sessionId}/push-to-sandbox`;
  router.handle(req, res, next);
});

module.exports = router;
