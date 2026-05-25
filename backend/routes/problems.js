'use strict';

const express = require('express');

const { requireInterviewer } = require('../auth/middleware');
const draftStore = require('../pipeline/stores/problemDraftStore');
const reviewStore = require('../pipeline/stores/reviewStore');
const problemAgent = require('../pipeline/agents/problemAgent');
const buildAgent = require('../pipeline/agents/buildAgent');
const { promote } = require('../pipeline/promoteToVerified');
const llm = require('../llm/client');
const shapeState = require('../pipeline/shape/shapeState');
const {
  mergeLockedPhase1Fields,
  repairSchemaFromMessages,
  parseChallengeDraftFromText,
  storedServicesMissingImageHints,
} = require('../pipeline/shape/shapeContract');
const { normalizeDraft, isDraftReady } = require('../pipeline/draft/draftSchema');

const router = express.Router();

const PORT = parseInt(process.env.PORT || '4000', 10);
const BACKEND_HOST = `localhost:${PORT}`;
const TERMINAL_WS_BASE = `ws://${BACKEND_HOST}`;

router.use(requireInterviewer);

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

function healMaterializedDraft(session) {
  if (!session?.schemaMaterialized || !session?.draft) return false;

  if (storedServicesMissingImageHints(session.draft)) {
    if (repairSchemaFromMessages(session)) return true;
    const normalized = normalizeDraft(session.draft);
    if (isDraftReady(normalized)) {
      session.draft = normalized;
      shapeState.syncShapePhase(session);
      return true;
    }
    return false;
  }

  if (!isDraftReady(session.draft) && repairSchemaFromMessages(session)) return true;
  return false;
}

function publicDraft(d) {
  if (!d) return null;
  shapeState.syncShapePhase(d);
  return {
    id: d.id,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    messages: d.messages,
    draft: d.draft,
    ...shapeState.publicShapeFields(d),
    buildStatus: d.buildStatus,
    buildSessionId: d.buildSessionId,
    buildDir: d.buildDir,
    buildAttempts: d.buildAttempts,
    buildLogs: d.buildLogs,
    buildChecklists: d.buildChecklists || [],
    buildLatestChecklist: d.buildLatestChecklist || null,
    builtChallenge: d.builtChallenge,
    buildValidation: d.buildValidation,
    buildCurrentPhase: d.buildCurrentPhase,
    buildCurrentAttempt: d.buildCurrentAttempt,
  };
}

router.get('/config', (_req, res) => {
  res.json({
    llmConfigured: llm.isConfigured(),
    provider: llm.getProvider(),
    model: llm.isConfigured() ? llm.getModel() : null,
    maxIterations: buildAgent.MAX_ITERATIONS,
  });
});

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
    const d = draftStore.makeDraft({ draft: null });
    shapeState.applyDraft(d, draft);
    d.messages.push({
      role: 'assistant',
      content: 'Imported a draft. Description and schema are ready — you can build or refine via regenerate schema.',
    });
    draftStore.set(d.id, d);
    await draftStore.persist(d);
    res.status(201).json({ sessionId: d.id, draft: publicDraft(d) });
  } catch (e) { next(e); }
});

router.get('/:sessionId', async (req, res, next) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });
    if (healMaterializedDraft(d)) {
      draftStore.set(d.id, d);
      await draftStore.persist(d);
    }
    res.json({ draft: publicDraft(d) });
  } catch (e) { next(e); }
});

router.delete('/:sessionId', async (req, res, next) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (d && d.buildDir) {
      await buildAgent.teardownBuild(d.buildSessionId || d.id, d.buildDir).catch(() => {});
    }
    await draftStore.remove(req.params.sessionId);
    await reviewStore.remove(req.params.sessionId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Phase 1: description chat (SSE) -------------------------------------

router.post('/:sessionId/chat', async (req, res) => {
  const d = draftStore.get(req.params.sessionId);
  if (!d) return res.status(404).json({ error: 'draft session not found' });

  shapeState.syncShapePhase(d);
  if (!shapeState.canChatDescription(d)) {
    return res.status(409).json({
      error: d.shapePhase === 'ready'
        ? 'description is locked — draft is ready for build'
        : 'description is approved — use Generate schema, or Edit contract to ask more questions in Phase 1',
      shapePhase: d.shapePhase,
      descriptionApproved: d.descriptionApproved,
    });
  }

  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'body must contain { message: "..." }' });
  }

  d.messages.push({ role: 'user', content: message });
  draftStore.set(d.id, d);

  const send = openSse(res);
  let assistantText = '';

  try {
    const { extracted } = await problemAgent.streamDescriptionTurn({
      messages: d.messages.map((m) => ({ role: m.role, content: m.content })),
      onEvent: (ev) => {
        if (ev.type === 'text') assistantText += ev.delta;
        send(ev);
      },
    });

    d.messages.push({ role: 'assistant', content: assistantText });
    if (extracted) shapeState.applyDescriptionExtraction(d, extracted);
    draftStore.set(d.id, d);
    await draftStore.persist(d);
    send({ type: 'shape', ...shapeState.publicShapeFields(d) });
  } catch (e) {
    console.warn('[problems/chat] error:', e.message);
    send({ type: 'error', message: e.message, code: e.code || null });
  } finally {
    try { res.end(); } catch (_e) { /* noop */ }
  }
});

// --- Approve description → Phase 2 ---------------------------------------

router.post('/:sessionId/approve-description', async (req, res, next) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });

    const validation = shapeState.validateShapeContract(d.draft);
    if (!validation.ok) {
      return res.status(400).json({
        error: 'design contract incomplete — chat until the agent emits a full <shape_contract>',
        missing: validation.missing,
      });
    }

    d.descriptionApproved = true;
    d.shapePhase = 'schema';
    draftStore.set(d.id, d);
    await draftStore.persist(d);

    res.json({ ok: true, draft: publicDraft(d) });
  } catch (e) { next(e); }
});

router.post('/:sessionId/revise-description', async (req, res, next) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });

    if (isDraftReady(d.draft)) {
      return res.status(409).json({
        error: 'draft is ready for build — create a new draft to change the design contract',
      });
    }

    d.descriptionApproved = false;
    d.shapePhase = 'description';
    d.schemaMaterialized = false;
    draftStore.set(d.id, d);
    await draftStore.persist(d);

    res.json({ ok: true, draft: publicDraft(d) });
  } catch (e) { next(e); }
});

// --- Phase 2: generate schema from catalogue (SSE) -------------------------

router.post('/:sessionId/generate-schema', async (req, res) => {
  const d = draftStore.get(req.params.sessionId);
  if (!d) return res.status(404).json({ error: 'draft session not found' });

  shapeState.syncShapePhase(d);
  if (!d.descriptionApproved) {
    return res.status(409).json({ error: 'approve the description before generating schema' });
  }
  if (!shapeState.isShapeContractComplete(d)) {
    return res.status(400).json({
      error: 'design contract incomplete — return to Phase 1 and finish <shape_contract>',
      missing: shapeState.validateShapeContract(d.draft).missing,
    });
  }

  const send = openSse(res);
  let assistantText = '';

  try {
    const { raw } = await problemAgent.generateSchema({
      sessionDraft: d.draft,
      onEvent: (ev) => {
        if (ev.type === 'text') assistantText += ev.delta;
        send(ev);
      },
    });

    if (!raw) {
      send({ type: 'error', message: 'agent did not emit valid <challenge_draft> JSON' });
      return;
    }

    const phase1Draft = d.draft;
    let merged = mergeLockedPhase1Fields(phase1Draft, raw);
    let normalized = normalizeDraft(merged);
    if (!isDraftReady(normalized)) {
      const fromText = parseChallengeDraftFromText(assistantText);
      if (fromText) {
        merged = mergeLockedPhase1Fields(phase1Draft, fromText);
        normalized = normalizeDraft(merged);
      }
    }

    shapeState.markSchemaMaterialized(d, normalized);
    d.messages.push({
      role: 'assistant',
      content: assistantText || '[Schema generated from catalogue]',
    });
    draftStore.set(d.id, d);
    await draftStore.persist(d);

    send({ type: 'draft', draft: normalized });
    send({ type: 'shape', shapePhase: d.shapePhase, draftReady: shapeState.computeDraftReady(d) });
  } catch (e) {
    console.warn('[problems/generate-schema] error:', e.message);
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
    return res.status(400).json({ error: 'no draft on this session; complete Shape first' });
  }
  if (!isDraftReady(d.draft)) {
    return res.status(400).json({
      error: 'draft incomplete — generate schema from catalogue first (description, rootCause, infra.services)',
    });
  }

  const send = openSse(res);

  d.buildStatus = 'building';
  d.buildAttempts = 0;
  d.buildLogs = [];
  d.buildChecklists = [];
  d.buildLatestChecklist = null;
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
    if (ev.type === 'checklist' && ev.checklist) {
      d.buildLatestChecklist = ev.checklist;
      d.buildChecklists = d.buildChecklists || [];
      d.buildChecklists.push(ev.checklist);
      if (d.buildChecklists.length > 20) d.buildChecklists.splice(0, d.buildChecklists.length - 20);
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
      draft: normalizeDraft(d.draft),
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
      title: result.builtChallenge.title || d.draft?.meta?.name || 'Untitled draft',
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

router.post('/:sessionId/push-to-sandbox', async (req, res, next) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });
    const result = await promote({
      buildDir: d.buildDir,
      builtChallenge: d.builtChallenge,
      fallbackTitle: d.draft?.meta?.name || d.draft?.title || d.id,
    });

    if (d.buildDir) {
      await buildAgent.teardownBuild(d.buildSessionId || d.id, d.buildDir).catch(() => {});
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

router.post('/:sessionId/finalize', (req, res, next) => {
  req.url = `/${req.params.sessionId}/push-to-sandbox`;
  router.handle(req, res, next);
});

module.exports = router;
