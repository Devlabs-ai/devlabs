'use strict';

/**
 * Standalone Spark agent triggers — run Data / Code / Eval one at a time
 * against a shape contract and a shared authoring workspace.
 *
 *   POST /api/spark/agents/data   — Claude → gen/  (new workspace or reuse)
 *   POST /api/spark/agents/code   — Claude → starter/ + solution/ (reuse workspace)
 *   POST /api/spark/agents/eval   — K8s gen + Spark platform + golden collect
 *   GET  /api/spark/agents/workspace/:workspaceId
 *
 * All long-running endpoints stream SSE (same event shape as Build).
 */

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

import * as fs from 'fs';
import * as path from 'path';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireInterviewer } = require('../auth/middleware');
const {
  normalizeSparkShapeContract,
  validateSparkShapeContract,
  ensureSparkWorkspace,
  sparkAuthoringRoot,
  writeShapeLock,
  readShapeLock,
  runSparkDataAgent,
  runSparkCodeAgent,
  runSparkEvalAgent,
  syncAuthoringAssetsToMinio,
} = require('../pipeline/spark');
const { withAgentLabel, agentDisplayName } = require('../pipeline/helpers/agentLogLabel');

const router = express.Router();
router.use(requireInterviewer);

function openSse(res: ExpressResponse): (event: unknown) => void {
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

function makeOnEvent(send: (event: unknown) => void) {
  return (ev: unknown) => {
    const evRec = ev as Record<string, unknown>;
    if (evRec.type === 'log' && evRec.message) {
      const msg = evRec.message as string;
      const detail = evRec.detail;
      const raw = detail != null && detail !== ''
        ? `${msg} — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
        : msg;
      evRec.message = withAgentLabel(evRec.tag || evRec.agent, raw);
    }
    if (evRec.type === 'thinking') {
      const agent = agentDisplayName(evRec.tag || evRec.agent);
      const base = typeof evRec.label === 'string' ? evRec.label : 'Working';
      if (agent && !String(base).includes(agent)) {
        evRec.label = `${agent} · ${base}`;
      }
    }
    send(ev);
  };
}

function extractShapeRaw(body: Record<string, unknown> | null | undefined): unknown {
  if (!body || typeof body !== 'object') return null;
  if (body.contract != null) return body.contract;
  if (body.sparkShape != null) return body.sparkShape;
  if (body.shape != null) return body.shape;
  // Raw contract uploaded as the body itself
  if (body.meta != null || body.brief != null) return body;
  return null;
}

function resolveWorkspaceId(body: Record<string, unknown> | null | undefined): string | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body.workspaceId ?? body.draftId ?? body.draftSessionId ?? body.folder;
  if (raw == null || raw === '') return null;
  return String(raw).trim();
}

/** Prevent path traversal — workspace ids are directory names under spark-authoring/. */
function assertSafeWorkspaceId(id: string): string {
  const cleaned = id.trim();
  if (!cleaned || cleaned.includes('..') || cleaned.includes('/') || cleaned.includes('\\')) {
    throw Object.assign(new Error('invalid workspaceId'), { status: 400 });
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(cleaned)) {
    throw Object.assign(new Error('workspaceId must be alphanumeric (dashes/underscores ok)'), { status: 400 });
  }
  return cleaned;
}

type AgentMode = 'scaffold' | 'repair';

function resolveAgentMode(body: Record<string, unknown> | null | undefined): AgentMode | null {
  if (!body || typeof body !== 'object') return null;
  const raw = String(body.mode || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'repair' || raw === 'fix' || raw === 'retry') return 'repair';
  if (raw === 'scaffold' || raw === 'fresh' || raw === 'new') return 'scaffold';
  throw Object.assign(
    new Error(`invalid mode "${raw}" — use scaffold|repair`),
    { status: 400 },
  );
}

/**
 * Build previousAttempt for Data/Code repair prompts from:
 *   - previousAttempt / attempt (full SparkStageAttempt)
 *   - error / errorMessage / message + context / stderr / stdout / details
 *   - eval/eval-failure.json in the workspace (when loadEvalFailure=true)
 */
function resolvePreviousAttempt(
  body: Record<string, unknown> | null | undefined,
  opts: {
    defaultPhase: 'DATA' | 'CODE' | 'EVAL';
    layout?: { eval: string };
    mode: AgentMode;
  },
): { mode: AgentMode; previousAttempt: {
  phase: string;
  message: string;
  details: Record<string, unknown> | null;
  rawText: string | null;
} | null } {
  const b = body || {};
  let mode = opts.mode;

  const pickAttempt = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as Record<string, unknown>;
    const message = String(a.message || a.error || '').trim();
    if (!message && !a.rawText && !a.details) return null;
    return {
      phase: String(a.phase || opts.defaultPhase),
      message: message || 'previous stage failure',
      details: (a.details && typeof a.details === 'object'
        ? a.details as Record<string, unknown>
        : null),
      rawText: a.rawText != null ? String(a.rawText) : null,
    };
  };

  let attempt = pickAttempt(b.previousAttempt)
    || pickAttempt(b.attempt)
    || pickAttempt(b.failure);

  // Flat error fields
  if (!attempt) {
    const errMsg = String(
      b.error ?? b.errorMessage ?? b.failureMessage ?? '',
    ).trim();
    const context = b.context ?? b.errorContext ?? b.stderr ?? null;
    const stdout = b.stdout != null ? String(b.stdout) : null;
    const stderr = typeof context === 'string'
      ? context
      : (context != null ? JSON.stringify(context) : null);
    if (errMsg || stderr) {
      attempt = {
        phase: String(b.phase || opts.defaultPhase),
        message: errMsg || 'Eval/previous failure (see details)',
        details: {
          step: b.step || null,
          repairOwner: b.repairOwner || null,
          where: b.where || null,
          stderr: stderr,
          stdout,
          ...(b.details && typeof b.details === 'object'
            ? b.details as Record<string, unknown>
            : {}),
        },
        rawText: stderr || errMsg || null,
      };
    }
  }

  // Auto-load last Eval failure report from the workspace
  if (!attempt && mode === 'repair' && opts.layout) {
    const reportPath = path.join(opts.layout.eval, 'eval-failure.json');
    if (fs.existsSync(reportPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
        attempt = {
          phase: 'EVAL',
          message: String(report.message || 'Eval failure (from eval-failure.json)'),
          details: {
            step: report.step || null,
            repairOwner: report.repairOwner || null,
            where: report.where || null,
            stderr: report.stderr || null,
            stdout: report.stdout || null,
            source: 'eval-failure.json',
          },
          rawText: String(report.stderr || report.rawText || report.message || ''),
        };
      } catch (_e) { /* ignore bad report */ }
    }
  }

  // Explicit scaffold → ignore any stray error fields
  if (mode === 'scaffold') {
    return { mode, previousAttempt: null };
  }

  if (mode === 'repair' && !attempt) {
    throw Object.assign(
      new Error(
        'mode=repair requires error context — pass error/previousAttempt, or ensure eval/eval-failure.json exists in the workspace',
      ),
      { status: 400 },
    );
  }

  return { mode, previousAttempt: attempt };
}

function resolveContract(
  body: Record<string, unknown> | null | undefined,
  layout: { root: string },
  { required }: { required: boolean },
) {
  const fromBody = extractShapeRaw(body || undefined);
  let contract = fromBody ? normalizeSparkShapeContract(fromBody) : null;
  if (!contract) {
    contract = normalizeSparkShapeContract(readShapeLock(layout));
  }
  if (!contract) {
    if (required) {
      throw Object.assign(
        new Error('shape JSON required — pass { shape } or reuse a workspace with shape.json'),
        { status: 400 },
      );
    }
    return null;
  }
  const missing = validateSparkShapeContract(contract);
  if (missing.length) {
    throw Object.assign(
      new Error(`invalid spark shape: ${missing.join(', ')}`),
      { status: 400, missing },
    );
  }
  return contract;
}

function listDirFiles(dir: string, max = 80): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, prefix: string) => {
    for (const name of fs.readdirSync(d)) {
      if (out.length >= max) return;
      const full = path.join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else out.push(rel);
    }
  };
  walk(dir, '');
  return out;
}

function publicLayout(workspaceId: string, layout: {
  root: string; gen: string; starter: string; solution: string; input: string; eval: string;
}) {
  return {
    workspaceId,
    workspaceRoot: layout.root,
    gen: layout.gen,
    starter: layout.starter,
    solution: layout.solution,
    input: layout.input,
    eval: layout.eval,
    shapePath: path.join(layout.root, 'shape.json'),
  };
}

// --- GET workspace snapshot -------------------------------------------------

router.get('/workspace/:workspaceId', (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const workspaceId = assertSafeWorkspaceId(String(req.params.workspaceId || ''));
    const root = sparkAuthoringRoot(workspaceId);
    if (!fs.existsSync(root)) {
      return res.status(404).json({ error: 'workspace not found', workspaceId });
    }
    const layout = ensureSparkWorkspace(workspaceId);
    const shape = readShapeLock(layout);
    res.json({
      ...publicLayout(workspaceId, layout),
      hasShape: Boolean(shape),
      slug: (shape as { meta?: { slug?: string } } | null)?.meta?.slug || null,
      files: {
        gen: listDirFiles(layout.gen),
        starter: listDirFiles(layout.starter),
        solution: listDirFiles(layout.solution),
        input: listDirFiles(layout.input, 40),
        eval: listDirFiles(layout.eval),
      },
    });
  } catch (e) { next(e); }
});

// --- Data Agent -------------------------------------------------------------

router.post('/data', async (req: ExpressRequest, res: ExpressResponse) => {
  const body = (req.body || {}) as Record<string, unknown>;
  let workspaceId: string;
  let modeHint: AgentMode | null;
  try {
    modeHint = resolveAgentMode(body);
    const provided = resolveWorkspaceId(body);
    // repair / error context always needs an existing workspace for in-place updates
    if ((modeHint === 'repair' || body.error || body.previousAttempt || body.attempt) && !provided) {
      return res.status(400).json({
        error: 'workspaceId (or draftId/folder) is required for Data Agent repair / in-place updates',
      });
    }
    workspaceId = provided ? assertSafeWorkspaceId(provided) : uuidv4();
  } catch (e) {
    return res.status((e as { status?: number }).status || 400).json({ error: (e as Error).message });
  }

  const reused = Boolean(resolveWorkspaceId(body));
  const root = sparkAuthoringRoot(workspaceId);
  if (reused && !fs.existsSync(root) && modeHint === 'repair') {
    return res.status(404).json({ error: 'workspace not found for repair', workspaceId });
  }

  const layout = ensureSparkWorkspace(workspaceId);
  let contract;
  try {
    contract = resolveContract(body, layout, { required: true });
  } catch (e) {
    return res.status((e as { status?: number }).status || 400).json({
      error: (e as Error).message,
      missing: (e as { missing?: string[] }).missing,
    });
  }

  let mode: AgentMode = 'scaffold';
  let previousAttempt = null as ReturnType<typeof resolvePreviousAttempt>['previousAttempt'];
  try {
    const resolved = resolvePreviousAttempt(body, {
      defaultPhase: 'EVAL',
      layout,
      mode: modeHint || (body.error || body.previousAttempt || body.attempt ? 'repair' : 'scaffold'),
    });
    mode = resolved.mode;
    previousAttempt = resolved.previousAttempt;
  } catch (e) {
    return res.status((e as { status?: number }).status || 400).json({ error: (e as Error).message });
  }

  writeShapeLock(layout, contract);
  const send = openSse(res);
  const onEvent = makeOnEvent(send);
  console.log(`[spark-agents] POST /data workspaceId=${workspaceId} mode=${mode} slug=${contract.meta.slug}`);

  send({
    type: 'log',
    level: 'info',
    tag: 'spark_data',
    message: `Data Agent workspace: ${layout.root} (mode=${mode}, reused=${reused})`,
    detail: { workspaceId, mode, reused, hasErrorContext: Boolean(previousAttempt) },
  });
  if (previousAttempt) {
    send({
      type: 'log',
      level: 'warn',
      tag: 'spark_data',
      message: `Repair context → ${previousAttempt.message}`.slice(0, 500),
    });
  }

  try {
    const result = await runSparkDataAgent({
      contract,
      genDir: layout.gen,
      draftSessionId: workspaceId,
      previousAttempt,
      onEvent,
    });
    send({
      type: 'done',
      ok: true,
      agent: 'data',
      mode,
      workspaceId,
      ...publicLayout(workspaceId, layout),
      hasWritten: result.hasWritten,
      summary: result.summary,
      files: { gen: listDirFiles(layout.gen) },
    });
  } catch (e) {
    send({ type: 'error', message: (e as Error).message, workspaceId, mode });
  } finally {
    try { res.end(); } catch (_e) { /* noop */ }
  }
});

// --- Code Agent -------------------------------------------------------------

router.post('/code', async (req: ExpressRequest, res: ExpressResponse) => {
  const body = (req.body || {}) as Record<string, unknown>;
  let workspaceId: string;
  let modeHint: AgentMode | null;
  try {
    modeHint = resolveAgentMode(body);
    const provided = resolveWorkspaceId(body);
    if (!provided) {
      return res.status(400).json({
        error: 'workspaceId (or draftId/folder) is required — pass the id from /data so starter/solution land in the same folder',
      });
    }
    workspaceId = assertSafeWorkspaceId(provided);
  } catch (e) {
    return res.status((e as { status?: number }).status || 400).json({ error: (e as Error).message });
  }

  const root = sparkAuthoringRoot(workspaceId);
  if (!fs.existsSync(root)) {
    return res.status(404).json({
      error: 'workspace not found — run POST /api/spark/agents/data first (or create the folder)',
      workspaceId,
    });
  }

  const layout = ensureSparkWorkspace(workspaceId);
  let contract;
  try {
    contract = resolveContract(body, layout, { required: true });
  } catch (e) {
    return res.status((e as { status?: number }).status || 400).json({
      error: (e as Error).message,
      missing: (e as { missing?: string[] }).missing,
    });
  }

  let mode: AgentMode = 'scaffold';
  let previousAttempt = null as ReturnType<typeof resolvePreviousAttempt>['previousAttempt'];
  try {
    const resolved = resolvePreviousAttempt(body, {
      defaultPhase: 'EVAL',
      layout,
      mode: modeHint || (body.error || body.previousAttempt || body.attempt ? 'repair' : 'scaffold'),
    });
    mode = resolved.mode;
    previousAttempt = resolved.previousAttempt;
  } catch (e) {
    return res.status((e as { status?: number }).status || 400).json({ error: (e as Error).message });
  }

  writeShapeLock(layout, contract);
  const send = openSse(res);
  const onEvent = makeOnEvent(send);
  console.log(`[spark-agents] POST /code workspaceId=${workspaceId} mode=${mode} slug=${contract.meta.slug}`);

  send({
    type: 'log',
    level: 'info',
    tag: 'spark_code',
    message: `Code Agent workspace: ${layout.root} (mode=${mode})`,
    detail: { workspaceId, mode, hasErrorContext: Boolean(previousAttempt) },
  });
  if (previousAttempt) {
    send({
      type: 'log',
      level: 'warn',
      tag: 'spark_code',
      message: `Repair context → ${previousAttempt.message}`.slice(0, 500),
    });
  }

  try {
    const result = await runSparkCodeAgent({
      contract,
      codeRoot: layout.root,
      draftSessionId: workspaceId,
      previousAttempt,
      onEvent,
    });

    try {
      const synced = await syncAuthoringAssetsToMinio({
        layout,
        slug: contract.meta.slug,
        draftSessionId: workspaceId,
      });
      send({
        type: 'log',
        level: 'info',
        tag: 'spark_code',
        message: `Synced authoring assets → MinIO (gen=${synced.gen.count}, starter=${synced.starter.count}, solution=${synced.solution.count})`,
      });
    } catch (syncErr) {
      send({
        type: 'log',
        level: 'warn',
        tag: 'spark_code',
        message: `MinIO sync warning: ${(syncErr as Error).message}`,
      });
    }

    send({
      type: 'done',
      ok: true,
      agent: 'code',
      mode,
      workspaceId,
      ...publicLayout(workspaceId, layout),
      hasWritten: result.hasWritten,
      summary: result.summary,
      files: {
        gen: listDirFiles(layout.gen),
        starter: listDirFiles(layout.starter),
        solution: listDirFiles(layout.solution),
      },
    });
  } catch (e) {
    send({ type: 'error', message: (e as Error).message, workspaceId, mode });
  } finally {
    try { res.end(); } catch (_e) { /* noop */ }
  }
});

// --- Eval Agent -------------------------------------------------------------

router.post('/eval', async (req: ExpressRequest, res: ExpressResponse) => {
  const body = (req.body || {}) as Record<string, unknown>;
  let workspaceId: string;
  try {
    const provided = resolveWorkspaceId(body);
    if (!provided) {
      return res.status(400).json({
        error: 'workspaceId (or draftId) is required',
      });
    }
    workspaceId = assertSafeWorkspaceId(provided);
  } catch (e) {
    return res.status((e as { status?: number }).status || 400).json({ error: (e as Error).message });
  }

  const root = sparkAuthoringRoot(workspaceId);
  if (!fs.existsSync(root)) {
    return res.status(404).json({ error: 'workspace not found', workspaceId });
  }

  const layout = ensureSparkWorkspace(workspaceId);
  let contract;
  try {
    contract = resolveContract(body, layout, { required: true });
  } catch (e) {
    return res.status((e as { status?: number }).status || 400).json({
      error: (e as Error).message,
      missing: (e as { missing?: string[] }).missing,
    });
  }

  const genFiles = listDirFiles(layout.gen);
  const solFiles = listDirFiles(layout.solution);
  if (!genFiles.some((f) => /\.py$/i.test(f))) {
    return res.status(400).json({
      error: 'gen/ has no .py script — run Data Agent first (or drop generate.py in place)',
      workspaceId,
      files: { gen: genFiles },
    });
  }
  if (!solFiles.some((f) => /\.py$/i.test(f))) {
    return res.status(400).json({
      error: 'solution/ has no .py — run Code Agent first (or drop solution src in place)',
      workspaceId,
      files: { solution: solFiles },
    });
  }

  writeShapeLock(layout, contract);
  const send = openSse(res);
  const onEvent = makeOnEvent(send);
  console.log(`[spark-agents] POST /eval workspaceId=${workspaceId} slug=${contract.meta.slug}`);

  send({
    type: 'log',
    level: 'info',
    tag: 'spark_eval',
    message: `Eval Agent workspace: ${layout.root}`,
    detail: { workspaceId },
  });

  try {
    try {
      const synced = await syncAuthoringAssetsToMinio({
        layout,
        slug: contract.meta.slug,
        draftSessionId: workspaceId,
      });
      send({
        type: 'log',
        level: 'info',
        tag: 'spark_eval',
        message: `Synced authoring assets → MinIO (gen=${synced.gen.count}, starter=${synced.starter.count}, solution=${synced.solution.count})`,
      });
    } catch (syncErr) {
      send({
        type: 'log',
        level: 'warn',
        tag: 'spark_eval',
        message: `MinIO sync warning: ${(syncErr as Error).message}`,
      });
    }

    const result = await runSparkEvalAgent({
      contract,
      layout,
      draftSessionId: workspaceId,
      onEvent,
    });

    // Surface failure handoff clearly on the terminal SSE event
    if (!result.passed && result.attempt) {
      const d = (result.attempt.details || {}) as Record<string, unknown>;
      send({
        type: 'log',
        level: 'error',
        tag: 'spark_eval',
        message: [
          '===== EVAL FAILURE SUMMARY (for Data/Code repair) =====',
          `step: ${d.step || 'unknown'}`,
          `repairOwner: ${d.repairOwner || 'unknown'}`,
          `where: ${d.where || 'unknown'}`,
          `message: ${result.message}`,
          '--- stderr / traceback ---',
          String(d.stderr || result.attempt.rawText || '').slice(-3500),
          '=======================================================',
        ].join('\n'),
      });
    }

    send({
      type: result.passed ? 'done' : 'error',
      ok: result.passed,
      agent: 'eval',
      workspaceId,
      ...publicLayout(workspaceId, layout),
      passed: result.passed,
      evalPath: result.evalPath,
      message: result.message,
      attempt: result.attempt,
      repairOwner: (result.attempt?.details as { repairOwner?: string } | null)?.repairOwner || null,
      failureReport: path.join(layout.eval, 'eval-failure.json'),
      files: {
        gen: listDirFiles(layout.gen),
        solution: listDirFiles(layout.solution),
        input: listDirFiles(layout.input, 40),
        eval: listDirFiles(layout.eval),
      },
    });
  } catch (e) {
    send({ type: 'error', message: (e as Error).message, workspaceId });
  } finally {
    try { res.end(); } catch (_e) { /* noop */ }
  }
});

module.exports = router;
