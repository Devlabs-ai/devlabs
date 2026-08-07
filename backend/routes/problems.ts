'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const path = require('path');

const { requireInterviewer } = require('../auth/middleware');
const draftStore = require('../pipeline/stores/problemDraftStore');
const reviewStore = require('../pipeline/stores/reviewStore');
const designAgent = require('../pipeline/agents/designAgent');
const sparkDesignAgent = require('../pipeline/spark/agents/designAgent');
const schemaAgent = require('../pipeline/agents/schemaAgent');
const buildPipeline = require('../pipeline/pipelines/buildPipeline');
const { runSparkAuthoringPipeline, ensureSparkWorkspace } = require('../pipeline/spark');
const { publishSparkChallenge } = require('../pipeline/spark/publish');
const { normalizeSparkShapeContract } = require('../pipeline/spark/shapeContract');
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
const {
  ChatDisplayStreamFilter,
} = require('../pipeline/helpers/chatDisplaySanitizer');
const { withAgentLabel, agentDisplayName } = require('../pipeline/helpers/agentLogLabel');

function emptySparkDraftPayload(): Record<string, unknown> {
  return {
    authoringKind: 'spark-platform',
    schemaVersion: 1,
    meta: { name: 'Untitled Spark lab' },
    description: '',
    sparkShape: null,
    sparkShapeApproved: false,
  };
}

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
  // Unified library: compose + Spark drafts (New draft creates Spark)
  const drafts = draftStore.list(uid);
  res.json({ drafts: drafts.map(publicDraft) });
});

router.post('/session', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    // New draft → Spark authoring (same UI; Spark agents). Pass { kind: 'compose' } for legacy compose.
    const kind = req.body?.kind === 'compose' ? 'compose' : 'spark-platform';
    const d = kind === 'spark-platform'
      ? draftStore.makeDraft({
        authoredBy: authorId(req),
        draft: emptySparkDraftPayload() as never,
      })
      : draftStore.makeDraft({ authoredBy: authorId(req) });
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

// Meta patch endpoint retained for compatibility; library buckets removed.
router.patch('/:sessionId/meta', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });
    return res.status(400).json({ error: 'no editable meta fields in request body' });
  } catch (e) { next(e); }
});

// --- Phase 1: design chat (SSE) ------------------------------------------

router.post('/:sessionId/chat', async (req: import("express").Request, res: import("express").Response) => {
  const d = draftStore.get(req.params.sessionId);
  if (!d) return res.status(404).json({ error: 'draft session not found' });

  shapeState.syncShapePhase(d);
  if (!shapeState.canChatDesign(d)) {
    const spark = shapeState.isSparkAuthoring(d);
    return res.status(409).json({
      error: d.shapePhase === 'ready'
        ? 'design contract is locked — draft is ready for build'
        : spark
          ? 'design contract is approved — use Edit contract to revise, or open Build'
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
  const displayFilter = new ChatDisplayStreamFilter();
  const spark = shapeState.isSparkAuthoring(d);

  try {
    const turn = spark
      ? sparkDesignAgent.streamSparkDesignTurn
      : designAgent.streamDesignTurn;
    const { extracted } = await turn({
      messages: d.messages.map((m: Record<string, unknown>) => ({ role: m.role, content: m.content })),
      onEvent: (ev: unknown) => {
        const event = ev as Record<string, unknown>;
        if (event.type === 'text') {
          assistantText += event.delta as string;
          const visible = displayFilter.pushDelta(event.delta as string);
          if (visible) send({ type: 'text', delta: visible });
          return;
        }
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

// --- Upload Spark shape contract JSON (same Preview path as chat extract) ---

router.post('/:sessionId/spark-shape', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });

    if (!shapeState.isSparkAuthoring(d)) {
      return res.status(400).json({ error: 'spark-shape upload is only for Spark platform drafts' });
    }

    shapeState.syncShapePhase(d);
    if (d.designApproved) {
      return res.status(409).json({
        error: 'design contract is locked — use Edit contract before uploading a new shape',
        shapePhase: d.shapePhase,
        designApproved: d.designApproved,
      });
    }

    const body = req.body || {};
    const raw = body.contract != null
      ? body.contract
      : (body.sparkShape != null ? body.sparkShape : body);

    const normalized = normalizeSparkShapeContract(raw);
    if (!normalized) {
      return res.status(400).json({
        error: 'invalid spark shape JSON — expected a spark_shape_contract object',
        hint: 'Upload the contract JSON (with meta, brief, data, transform, platform, evalCollection) or wrap it as { "contract": { … } }',
      });
    }

    shapeState.applyDesignExtraction(d, normalized as unknown as Record<string, unknown>);
    // Keep unapproved so Preview → Approve matches the chat flow
    d.designApproved = false;
    d.schemaMaterialized = false;
    d.shapePhase = 'design';
    (d.draft as Record<string, unknown>).sparkShapeApproved = false;
    (d.draft as Record<string, unknown>).sparkShape = normalized;

    d.messages = d.messages || [];
    d.messages.push({
      role: 'user',
      content: `[Uploaded spark shape contract JSON — slug: ${normalized.meta.slug}]`,
    });
    d.messages.push({
      role: 'assistant',
      content: `Loaded shape contract **${normalized.meta.name}** (\`${normalized.meta.slug}\`) into Preview. Review it on the left, then **Approve design** when ready — or keep chatting to refine.`,
    });

    draftStore.set(d.id, d);
    await draftStore.persist(d);

    res.json({
      ok: true,
      draft: publicDraft(d),
      ...shapeState.publicShapeFields(d),
    });
  } catch (e) { next(e); }
});

// --- Approve design contract → Phase 2 -----------------------------------

router.post('/:sessionId/approve-design', async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const d = draftStore.get(req.params.sessionId);
    if (!d) return res.status(404).json({ error: 'draft session not found' });

    if (shapeState.isSparkAuthoring(d)) {
      const missing = shapeState.sparkShapeMissing(d);
      if (missing.length) {
        return res.status(400).json({
          error: 'spark shape incomplete — chat until the agent emits a full <spark_shape_contract>',
          missing,
        });
      }
      const draft = d.draft as Record<string, unknown>;
      draft.sparkShapeApproved = true;
      d.designApproved = true;
      d.schemaMaterialized = true;
      d.shapePhase = 'ready';
      // Persist normalized shape so Build / Publish see a canonical contract
      const normalized = normalizeSparkShapeContract(draft.sparkShape);
      if (normalized) {
        draft.sparkShape = normalized;
        draft.meta = { ...(draft.meta as object || {}), name: normalized.meta.name, slug: normalized.meta.slug };
        draft.description = normalized.brief.description;
      }
      draftStore.set(d.id, d);
      await draftStore.persist(d);
      return res.json({ ok: true, draft: publicDraft(d) });
    }

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

    if (shapeState.isSparkAuthoring(d)) {
      if (d.buildStatus === 'review_ready') {
        return res.status(409).json({
          error: 'pipeline already passed — create a new draft to change the shape',
        });
      }
      const draft = d.draft as Record<string, unknown>;
      draft.sparkShapeApproved = false;
      d.designApproved = false;
      d.schemaMaterialized = false;
      d.shapePhase = 'design';
      draftStore.set(d.id, d);
      await draftStore.persist(d);
      return res.json({ ok: true, draft: publicDraft(d) });
    }

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

  if (shapeState.isSparkAuthoring(d)) {
    return res.status(409).json({
      error: 'Spark labs have no schema agent — approve the shape, then open Build',
    });
  }

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
  const displayFilter = new ChatDisplayStreamFilter();

  try {
    const { raw } = await schemaAgent.generateSchema({
      sessionDraft: d.draft,
      onEvent: (ev: unknown) => {
        const event = ev as Record<string, unknown>;
        if (event.type === 'text') {
          assistantText += event.delta as string;
          const visible = displayFilter.pushDelta(event.delta as string);
          if (visible) send({ type: 'text', delta: visible });
          return;
        }
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

  // Spark authoring pipeline (Data∥Code → Validate → Eval)
  if (shapeState.isSparkAuthoring(d)) {
    if (!d.designApproved || shapeState.sparkShapeMissing(d).length) {
      return res.status(400).json({
        error: 'approve a complete spark shape before building',
        missing: shapeState.sparkShapeMissing(d),
      });
    }

    const contract = normalizeSparkShapeContract(
      (d.draft as { sparkShape?: unknown }).sparkShape,
    );
    if (!contract) {
      return res.status(400).json({ error: 'invalid sparkShape on draft' });
    }

    const send = openSse(res);
    console.log(`[build] POST /api/problems/${req.params.sessionId}/build (spark)`);

    const buildMode = req.body?.mode === 'retry' ? 'retry' : (req.body?.mode === 'fresh' ? 'fresh' : null);
    const isRetry = buildMode === 'retry'
      || (buildMode !== 'fresh' && d.buildStatus === 'failed');
    const { loadSparkStageFailure } = require('../pipeline/spark/stageAttempt');
    const layout = ensureSparkWorkspace(d.id);
    const previousAttempt = isRetry
      ? loadSparkStageFailure(layout.eval, {
        phase: d.buildFailedPhase || null,
        message: d.buildFailedMsg || null,
      })
      : null;

    if (isRetry) {
      if (d.buildLogs?.length) {
        d.buildLogs.push('--- Retrying spark build in repair mode ---');
      }
    } else {
      d.buildLogs = [];
    }

    d.buildStatus = 'building';
    d.buildAttempts = 0;
    d.buildCurrentPhase = null;
    d.buildCurrentAttempt = 0;
    d.buildLatestChecklist = null;
    draftStore.set(d.id, d);

    const appendBuildLog = (line: string) => {
      d.buildLogs = d.buildLogs || [];
      d.buildLogs.push(line);
      if (d.buildLogs.length > 1000) d.buildLogs.splice(0, d.buildLogs.length - 1000);
    };

    const onEvent = (ev: unknown) => {
      const evRec = ev as Record<string, unknown>;
      if (evRec.type === 'log' && evRec.message) {
        const msg = evRec.message as string;
        const detail = evRec.detail;
        const raw = detail != null && detail !== ''
          ? `${msg} — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
          : msg;
        const line = withAgentLabel(evRec.tag || evRec.agent, raw);
        evRec.message = line;
        appendBuildLog(line);
      }
      if (evRec.type === 'thinking') {
        const agent = agentDisplayName(evRec.tag || evRec.agent);
        const base = typeof evRec.label === 'string' ? evRec.label : 'Working';
        if (agent && !String(base).includes(agent)) {
          evRec.label = `${agent} · ${base}`;
        }
      }
      if (evRec.type === 'phase') {
        d.buildCurrentPhase = evRec.phase as string;
        d.buildCurrentAttempt = evRec.attempt as number;
        d.buildAttempts = Math.max(d.buildAttempts || 0, (evRec.attempt as number) || 0);
      }
      if (evRec.type === 'error' && evRec.message) {
        d.buildFailedMsg = evRec.message as string;
      }
      draftStore.set(d.id, d);
      draftStore.snapshotBuildState(d).catch(() => {});
      send(ev);
    };

    try {
      const result = await runSparkAuthoringPipeline({
        draftSessionId: d.id,
        contract,
        onEvent,
        previousAttempt,
      });
      d.buildDir = layout.root;
      d.buildStatus = result.passed ? 'review_ready' : 'failed';
      d.buildValidation = { passed: !!result.passed };
      if (!result.passed) {
        d.buildFailedMsg = result.message || 'Spark pipeline failed';
        d.buildFailedPhase = result.lastAttempt?.phase || d.buildCurrentPhase;
      } else {
        d.buildFailedMsg = null;
        d.buildFailedPhase = null;
        d.builtChallenge = {
          id: contract.meta.slug,
          title: contract.meta.name,
          sandboxType: 'spark-platform',
          evalPath: result.evalPath,
        };
        await reviewStore.upsert({
          draftSessionId: d.id,
          title: contract.meta.name,
          builtChallenge: d.builtChallenge,
          buildValidation: d.buildValidation,
          buildDir: d.buildDir,
        });
      }
      draftStore.set(d.id, d);
      await draftStore.persist(d).catch(() => {});
      // done/error already emitted by pipeline; ensure done on pass
      if (result.passed) send({ type: 'done' });
    } catch (e) {
      d.buildStatus = 'failed';
      d.buildFailedMsg = (e as Error).message;
      draftStore.set(d.id, d);
      await draftStore.persist(d).catch(() => {});
      send({ type: 'error', message: (e as Error).message });
    } finally {
      try { res.end(); } catch (_e) { /* noop */ }
    }
    return;
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
      const raw = detail != null && detail !== ''
        ? `${msg} — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
        : msg;
      const line = withAgentLabel(evRec.tag || evRec.agent, raw);
      evRec.message = line;
      appendBuildLog(line);
    }
    if (evRec.type === 'thinking') {
      const step = typeof evRec.step === 'number' ? evRec.step : 0;
      const agent = agentDisplayName(evRec.tag || evRec.agent);
      let label = typeof evRec.label === 'string' ? evRec.label : 'Thinking';
      if (agent && !label.includes(agent)) {
        label = `${agent} · ${label}`;
        evRec.label = label;
      }
      appendBuildLog(withAgentLabel(evRec.tag || evRec.agent, `💭 ${label} (step ${step + 1})`));
    }
    if (evRec.type === 'codeDiff' && typeof evRec.diff === 'string') {
      const tool = typeof evRec.tool === 'string' ? evRec.tool : 'code';
      const filePath = typeof evRec.path === 'string' ? evRec.path : 'unknown';
      const header = evRec.summary
        ? '📋 CODE repair summary'
        : `📋 CODE diff · ${tool} · ${filePath}`;
      appendBuildLog(withAgentLabel(evRec.tag || 'code', header));
      for (const diffLine of (evRec.diff as string).split('\n')) {
        appendBuildLog(`📋  ${diffLine}`);
      }
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

    if (shapeState.isSparkAuthoring(d)) {
      if (d.buildStatus !== 'review_ready') {
        return res.status(400).json({ error: 'run Spark pipeline successfully before publishing' });
      }
      const contract = normalizeSparkShapeContract(
        (d.draft as { sparkShape?: unknown }).sparkShape,
      );
      if (!contract) {
        return res.status(400).json({ error: 'invalid sparkShape on draft' });
      }
      const layout = ensureSparkWorkspace(d.id);
      const published = await publishSparkChallenge({ contract, layout });
      d.builtChallenge = {
        ...(d.builtChallenge || {}),
        challengeId: published.challengeId,
        id: published.challengeId,
      };
      draftStore.set(d.id, d);
      await draftStore.persist(d).catch(() => {});
      await draftStore.remove(d.id);
      await reviewStore.remove(d.id);
      return res.json({
        ok: true,
        slug: published.challengeId,
        challengeId: published.challengeId,
        challenge: { id: published.challengeId, sandboxType: 'spark-platform' },
      });
    }

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
