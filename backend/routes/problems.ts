'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const path = require('path');

const { requireInterviewer } = require('../auth/middleware');
const draftStore = require('../pipeline/stores/problemDraftStore');
const reviewStore = require('../pipeline/stores/reviewStore');
const designAgent = require('../pipeline/agents/designAgent');
const schemaAgent = require('../pipeline/agents/schemaAgent');
const buildPipeline = require('../pipeline/pipelines/buildPipeline');
const { loadLatestBuildFailure, recordBuildFailure } = require('../pipeline/build/buildFailureRecord');
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
const { normalizeBucket } = require('../challenges/buckets');

const router = express.Router();

const PORT = parseInt(process.env.PORT || '4000', 10);
const BACKEND_HOST = `localhost:${PORT}`;
const TERMINAL_WS_BASE = `ws://${BACKEND_HOST}`;

router.use(requireInterviewer);

function openSse(res: import("express").Response): (event: unknown) => void {
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

function healMaterializedDraft(session: Record<string, unknown>): boolean {
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

function publicDraft(d: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!d) return null;
  draftStore.hydrateBuildLogsIfNeeded(d);
  shapeState.syncShapePhase(d);
  return {
    id: d.id,
    authoredBy: d.authoredBy || null,
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
    reviewFeedback: d.reviewFeedback || null,
    buildFailedDir: d.buildFailedDir || null,
    buildFailedSessionId: d.buildFailedSessionId || null,
    buildFailedPhase: d.buildFailedPhase || null,
    buildFailedMsg: d.buildFailedMsg || null,
  };
}

function authorId(req: import("express").Request): string | null {
  return req.user?.sub || null;
}

function assertDraftAccess(d: Record<string, unknown> | null, req: import("express").Request): boolean {
  const uid = authorId(req);
  if (!d) return false;
  if (!d.authoredBy) return true;
  if (!uid) return false;
  return d.authoredBy === uid;
}

router.get('/config', (_req: import("express").Request, res: import("express").Response) => {
  const report = llm.configurationReport();
  res.json({
    llmConfigured: report.allConfigured,
    provider: llm.getProvider(),
    model: report.allConfigured ? llm.getModel() : null,
    models: report.models,
    providers: report.providers,
    maxIterations: buildPipeline.MAX_ITERATIONS,
  });
});

router.get('/', (req: import("express").Request, res: import("express").Response) => {
  const uid = authorId(req);
  res.json({ drafts: draftStore.list(uid).map(publicDraft) });
});

router.post('/session', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const d = draftStore.makeDraft({ authoredBy: authorId(req) });
    draftStore.set(d.id, d);
    await draftStore.persist(d);
    res.status(201).json({ sessionId: d.id, draft: publicDraft(d) });
  } catch (e) { next(e); }
});

router.post('/import-draft', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const { draft } = req.body || {};
    if (!draft || typeof draft !== 'object') {
      return res.status(400).json({ error: 'body must contain { draft: { ... } }' });
    }
    const d = draftStore.makeDraft({ draft: null, authoredBy: authorId(req) });
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

router.get('/:sessionId', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });
    if (!assertDraftAccess(d, req)) {
      return res.status(403).json({ error: 'you do not have access to this draft' });
    }
    if (healMaterializedDraft(d)) {
      draftStore.set(d.id, d);
      await draftStore.persist(d);
    }
    res.json({ draft: publicDraft(d) });
  } catch (e) { next(e); }
});

router.delete('/:sessionId', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (d && !assertDraftAccess(d, req)) {
      return res.status(403).json({ error: 'you do not have access to this draft' });
    }
    if (d && d.buildDir) {
      await buildPipeline.teardownBuild(d.buildSessionId || d.id, d.buildDir).catch(() => {});
    }
    await draftStore.remove(req.params.sessionId);
    await reviewStore.remove(req.params.sessionId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Patch a small, safe subset of draft.meta. Currently only `bucket` is allowed;
// extend this allow-list deliberately rather than blanket-merging req.body so we
// never let clients overwrite agent-emitted contract fields (name/category/etc).
router.patch('/:sessionId/meta', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });

    const patch: { bucket?: string | null } = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'bucket')) {
      const raw = req.body.bucket;
      if (raw === null || raw === '') {
        patch.bucket = null;
      } else {
        const bucket = normalizeBucket(raw);
        if (!bucket) return res.status(400).json({ error: `unknown bucket: ${raw}` });
        patch.bucket = bucket;
      }
    }

    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'no editable meta fields in request body' });
    }

    d.draft = d.draft || {};
    d.draft.meta = { ...(d.draft.meta || {}), ...patch };
    draftStore.set(d.id, d);
    await draftStore.persist(d);
    res.json({ draft: publicDraft(d) });
  } catch (e) { next(e); }
});

// --- Phase 1: design chat (SSE) ------------------------------------------

router.post('/:sessionId/chat', async (req: import("express").Request, res: import("express").Response) => {
  const d = draftStore.get(req.params.sessionId);
  if (!d) return res.status(404).json({ error: 'draft session not found' });

  shapeState.syncShapePhase(d);
  if (!shapeState.canChatDesign(d)) {
    return res.status(409).json({
      error: d.shapePhase === 'ready'
        ? 'design contract is locked — draft is ready for build'
        : 'design contract is approved — use Generate schema, or Edit contract to ask more questions in Phase 1',
      shapePhase: d.shapePhase,
      designApproved: d.designApproved,
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
    const { extracted } = await designAgent.streamDesignTurn({
      messages: d.messages.map((m: Record<string, unknown>) => ({ role: m.role, content: m.content })),
      onEvent: (ev: unknown) => {
        if ((ev as Record<string, unknown>).type === 'text') assistantText += (ev as Record<string, unknown>).delta;
        send(ev);
      },
    });

    d.messages.push({ role: 'assistant', content: assistantText });
    if (extracted) shapeState.applyDesignExtraction(d, extracted);
    draftStore.set(d.id, d);
    await draftStore.persist(d);
    send({ type: 'shape', ...shapeState.publicShapeFields(d) });
  } catch (e) {
    console.warn('[problems/chat] error:', (e as Error).message);
    send({ type: 'error', message: (e as Error).message, code: (e as Error & { code?: string }).code || null });
  } finally {
    try { res.end(); } catch (_e) { /* noop */ }
  }
});

// --- Approve design contract → Phase 2 -----------------------------------

router.post('/:sessionId/approve-design', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
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

    d.designApproved = true;
    d.shapePhase = 'schema';
    draftStore.set(d.id, d);
    await draftStore.persist(d);

    res.json({ ok: true, draft: publicDraft(d) });
  } catch (e) { next(e); }
});

router.post('/:sessionId/revise-design', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });

    if (isDraftReady(d.draft)) {
      return res.status(409).json({
        error: 'draft is ready for build — create a new draft to change the design contract',
      });
    }

    d.designApproved = false;
    d.shapePhase = 'design';
    d.schemaMaterialized = false;
    // Strip Phase 2 image_hints back to name-only so isDraftReady returns false
    if (d.draft?.infra?.services?.length) {
      d.draft.infra.services = d.draft.infra.services.map((s: unknown) => ({
        name: typeof s === 'string' ? s : (s as Record<string, unknown>).name as string,
      }));
    }
    draftStore.set(d.id, d);
    await draftStore.persist(d);

    res.json({ ok: true, draft: publicDraft(d) });
  } catch (e) { next(e); }
});

// --- Phase 2: generate schema from catalogue (SSE) -------------------------

router.post('/:sessionId/generate-schema', async (req: import("express").Request, res: import("express").Response) => {
  const d = draftStore.get(req.params.sessionId);
  if (!d) return res.status(404).json({ error: 'draft session not found' });

  shapeState.syncShapePhase(d);
  if (!d.designApproved) {
    return res.status(409).json({ error: 'approve the design contract before generating schema' });
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
    const { raw } = await schemaAgent.generateSchema({
      sessionDraft: d.draft,
      onEvent: (ev: unknown) => {
        if ((ev as Record<string, unknown>).type === 'text') assistantText += (ev as Record<string, unknown>).delta;
        send(ev);
      },
    });

    if (!raw) {
      const tail = assistantText ? assistantText.slice(-300) : '(empty)';
      send({
        type: 'error',
        message: `agent did not emit valid <challenge_draft> JSON — response tail: ${tail}`,
      });
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

router.post('/:sessionId/build', async (req: import("express").Request, res: import("express").Response) => {
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

  console.log(`[build] POST /api/problems/${req.params.sessionId}/build`);

  const buildMode = req.body?.mode === 'fresh' ? 'fresh' : (req.body?.mode === 'retry' ? 'retry' : null);
  const failedWorkspace = d.buildFailedDir || d.buildDir || null;
  const canRetry = d.buildStatus === 'failed' && !!failedWorkspace;
  const isRetry = buildMode === 'retry' || (buildMode !== 'fresh' && canRetry);
  const isFresh = buildMode === 'fresh' || !isRetry;

  if (isFresh && d.buildFailedDir) {
    const oldSessionId = d.buildFailedSessionId || path.basename(d.buildFailedDir);
    await buildPipeline.teardownBuild(oldSessionId, d.buildFailedDir).catch(() => {});
    d.buildFailedDir = null;
    d.buildFailedSessionId = null;
    d.buildFailedPhase = null;
    d.buildFailedMsg = null;
  }

  const prevFailedBuildDir = isRetry ? failedWorkspace : null;
  let prevFailurePhase = isRetry ? (d.buildFailedPhase || null) : null;
  let prevFailureMsg = isRetry ? (d.buildFailedMsg || null) : null;

  if (isRetry && prevFailedBuildDir && (!prevFailurePhase || !prevFailureMsg)) {
    const diskFailure = loadLatestBuildFailure(prevFailedBuildDir);
    if (diskFailure) {
      prevFailurePhase = prevFailurePhase || diskFailure.phase || null;
      prevFailureMsg = prevFailureMsg || diskFailure.message || null;
    }
  }

  d.buildStatus = 'building';
  d.buildAttempts = 0;
  if (isRetry) {
    if (d.buildLogs?.length) {
      d.buildLogs.push('--- Retrying build in same workspace ---');
    }
  } else {
    d.buildLogs = [];
  }
  d.buildChecklists = isRetry ? (d.buildChecklists || []) : [];
  d.buildLatestChecklist = null;
  d.buildCurrentPhase = null;
  d.buildCurrentAttempt = 0;
  d.reviewFeedback = null;
  draftStore.set(d.id, d);
  await draftStore.snapshotBuildState(d);
  await draftStore.persist(d).catch(() => {});

  const appendBuildLog = (line: string) => {
    d.buildLogs.push(line);
    if (d.buildLogs.length > 1000) d.buildLogs.splice(0, d.buildLogs.length - 1000);
  };

  const onEvent = (ev: unknown) => {
    const evRec = ev as Record<string, unknown>;
    if (evRec.type === 'log' && evRec.message) {
      const msg = evRec.message as string;
      const detail = evRec.detail;
      const line = detail != null && detail !== ''
        ? `${msg} — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
        : msg;
      appendBuildLog(line);
    }
    if (evRec.type === 'thinking') {
      const step = typeof evRec.step === 'number' ? evRec.step : 0;
      const label = typeof evRec.label === 'string' ? evRec.label : 'Thinking';
      appendBuildLog(`💭 ${label} (step ${step + 1})`);
    }
    if (evRec.type === 'checklist' && evRec.checklist) {
      d.buildLatestChecklist = (ev as Record<string, unknown>).checklist;
      d.buildChecklists = d.buildChecklists || [];
      d.buildChecklists.push((ev as Record<string, unknown>).checklist);
      if (d.buildChecklists.length > 20) d.buildChecklists.splice(0, d.buildChecklists.length - 20);
    }
    if ((ev as Record<string, unknown>).type === 'phase') {
      d.buildCurrentPhase = (ev as Record<string, unknown>).phase;
      d.buildCurrentAttempt = (ev as Record<string, unknown>).attempt;
      const evTyped = ev as Record<string, unknown>;
      d.buildAttempts = Math.max(d.buildAttempts, evTyped.attempt as number);
    }
    if ((ev as Record<string, unknown>).type === 'buildDir') {
      d.buildDir = (ev as Record<string, unknown>).buildDir;
    }
    if ((ev as Record<string, unknown>).type === 'error' && (ev as Record<string, unknown>).failedBuildDir) {
      // Store the failed build dir so a future re-run can resume from it
      const evTyped = ev as Record<string, unknown>;
      d.buildFailedDir = evTyped.failedBuildDir;
      d.buildFailedSessionId = evTyped.failedBuildSessionId;
      const lastAttempt = evTyped.lastAttempt as Record<string, unknown> | undefined;
      d.buildFailedPhase = lastAttempt?.phase || null;
      d.buildFailedMsg = lastAttempt?.message || null;
    }
    draftStore.set(d.id, d);
    draftStore.snapshotBuildState(d).catch(() => {});
    send(ev);
  };

  try {
    const result = await buildPipeline.runBuildLoop({
      draft: normalizeDraft(d.draft),
      draftSessionId: d.id,
      onEvent,
      terminalWsBase: TERMINAL_WS_BASE,
      resumeBuildDir: prevFailedBuildDir,
      resumeFailurePhase: prevFailurePhase,
      resumeFailureMsg: prevFailureMsg,
    });

    d.buildSessionId = result.buildSessionId;
    d.buildDir = result.buildDir;
    d.builtChallenge = result.builtChallenge;
    d.buildValidation = result.buildValidation;
    d.buildStatus = 'review_ready';
    // Successful build — clear any stale failed-build context
    d.buildFailedDir = null;
    d.buildFailedSessionId = null;
    d.buildFailedPhase = null;
    d.buildFailedMsg = null;
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
    const err = e as Error & { lastAttempt?: { phase?: string; message?: string } | null };
    if (err.lastAttempt) {
      d.buildFailedPhase = err.lastAttempt.phase || d.buildFailedPhase || null;
      d.buildFailedMsg = err.lastAttempt.message || d.buildFailedMsg || null;
    }
    if (!d.buildFailedDir && d.buildDir) {
      d.buildFailedDir = d.buildDir;
      d.buildFailedSessionId = d.buildSessionId || null;
    }
    const failDir = d.buildFailedDir || d.buildDir;
    if (failDir) {
      recordBuildFailure(failDir, {
        recordedAt: Date.now(),
        draftSessionId: d.id,
        buildSessionId: d.buildFailedSessionId || d.buildSessionId || null,
        reason: 'error',
        phase: d.buildFailedPhase,
        message: d.buildFailedMsg,
        buildStatus: 'failed',
        lastLogs: Array.isArray(d.buildLogs) ? d.buildLogs.slice(-50) : [],
      });
    }
    draftStore.set(d.id, d);
    await draftStore.persist(d).catch(() => {});
    send({ type: 'error', message: err.message, code: (err as { code?: string }).code || null, lastFailure: (err as { lastFailure?: string }).lastFailure || null });
  } finally {
    try { res.end(); } catch (_e) { /* noop */ }
  }
});

router.post('/:sessionId/cancel-build', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });
    if (d.buildStatus !== 'building') {
      return res.json({ ok: true, buildStatus: d.buildStatus });
    }
    const cancelPhase = d.buildCurrentPhase || d.buildFailedPhase || 'cancelled';
    d.buildStatus = 'failed';
    d.buildCurrentPhase = null;
    const failDir = d.buildFailedDir || d.buildDir;
    if (failDir) {
      if (!d.buildFailedDir) {
        d.buildFailedDir = failDir;
        d.buildFailedSessionId = d.buildSessionId || path.basename(failDir);
      }
      d.buildFailedPhase = cancelPhase;
      d.buildFailedMsg = 'Build cancelled by user';
      recordBuildFailure(failDir, {
        recordedAt: Date.now(),
        draftSessionId: d.id,
        buildSessionId: d.buildFailedSessionId || d.buildSessionId || null,
        reason: 'cancel',
        phase: cancelPhase,
        message: d.buildFailedMsg,
        iteration: d.buildCurrentAttempt || d.buildAttempts || null,
        buildStatus: 'failed',
        lastLogs: Array.isArray(d.buildLogs) ? d.buildLogs.slice(-50) : [],
      });
    } else {
      d.buildFailedPhase = cancelPhase;
      d.buildFailedMsg = 'Build cancelled by user';
    }
    draftStore.set(d.id, d);
    await draftStore.persist(d).catch(() => {});
    return res.json({ ok: true, buildStatus: 'failed' });
  } catch (e) {
    next(e);
  }
});

router.post('/:sessionId/push-to-sandbox', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });
    const result = await promote({
      buildDir: d.buildDir,
      builtChallenge: d.builtChallenge,
      fallbackTitle: d.draft?.meta?.name || d.draft?.title || d.id,
      authoredBy: req.user?.sub || null,
    });

    if (d.buildDir) {
      await buildPipeline.teardownBuild(d.buildSessionId || d.id, d.buildDir).catch(() => {});
    }
    await draftStore.remove(d.id);
    await reviewStore.remove(d.id);

    res.json({
      ok: true,
      slug: result.slug,
      verifiedDir: result.verifiedDir,
      challenge: result.challenge,
    });
  } catch (e) { next(e); }
});

router.post('/:sessionId/finalize', (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  req.url = `/${req.params.sessionId}/push-to-sandbox`;
  router.handle(req, res, next);
});

module.exports = router;
