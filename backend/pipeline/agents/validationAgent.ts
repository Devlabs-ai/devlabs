'use strict';

/**
 * VALIDATE agent — Phase 3 of the build pipeline.
 *
 * Runs validationSpec.graph (preferred) or legacy validationSpec.steps,
 * then sends snapshots/evidence to an LLM judge.
 */

import type { ChallengeDraft, PortMap, ValidationResult, ValidationStep, ChecklistItem } from '../../types/domain';
import type { ValidationGraphSpec, ValidationGraphSuiteResult, ValidationGraphEntry, ValidationGraphNodeSnapshot } from '../validation/validationGraphTypes';

const composeManager = require('../../sandbox/composeManager');
const llm = require('../../llm/client');
const { evaluateCheck } = require('../validation/validationChecks');
const { normalizeDraft } = require('../draft/draftSchema');
const { emitLog } = require('../build/buildLogger');
const {
  buildValidationChecklist,
  applyValidationResults,
  applyGraphValidationResults,
} = require('../validation/validationChecklist');
const { SYSTEM_PROMPT } = require('../prompts/validationAgent.prompt');
const { normalizeValidationSteps } = require('../validation/validationStepNormalize');
const { hasValidationGraph, getValidationGraphEntries, runValidationGraphSuite } = require('../validation/validationGraphExecutor');

interface EvidenceItem {
  step: ValidationStep;
  ok: boolean;
  stdout: string;
  stderr: string;
  error: string | null;
  statusCode: number | null;
}

/** Execute one legacy validationSpec step. */
async function runStep(
  buildDir: string,
  portMap: PortMap,
  step: ValidationStep,
  ctx: { metricsService?: string | null } = {},
): Promise<EvidenceItem> {
  const out: EvidenceItem = { step, ok: false, stdout: '', stderr: '', error: null, statusCode: null };

  try {
    if (step.type === 'http') {
      const portField = `HOST_PORT_${(step.service || '').toUpperCase().replace(/-/g, '_')}`;
      const externalPort = portMap[portField] || step.port;
      const url = `http://localhost:${externalPort}${step.path || '/'}`;
      const res = await fetch(url, { method: step.method || 'GET' }).catch((e: Error) => ({
        ok: false,
        status: 0,
        text: async () => `fetch failed: ${e.message}`,
      }));
      out.statusCode = (res as Response).status || 0;
      out.stdout = await (res as Response).text().catch(() => '');
      out.ok = !!(res as Response).ok;
    } else if (step.type === 'exec') {
      const cmd = Array.isArray(step.cmd) ? step.cmd : [step.cmd as string];
      const { stdout, stderr } = await composeManager.exec(buildDir, step.service!, cmd, { portMap });
      out.stdout = stdout;
      out.stderr = stderr;
      out.ok = true;
    } else if (step.type === 'metricCheck') {
      const svc = ctx.metricsService || 'load-generator';
      const raw = step as ValidationStep & { field?: string; threshold?: number; condition?: string; windowSeconds?: number };
      const field = raw.field || 'errors';
      const threshold = Number(raw.threshold ?? 1);
      const condition = raw.condition || 'gte';
      const tail = Math.max(10, Math.min(Number(raw.windowSeconds) || 30, 200));
      const { stdout, stderr } = await composeManager.logs(buildDir, svc, { tail, portMap });
      out.stdout = stdout;
      out.stderr = stderr;
      const hay = `${stdout}\n${stderr}`;
      const metricRe = new RegExp(`METRIC[^\\n]*\\b${field}=([\\d.]+)`, 'g');
      let peak = 0;
      let m: RegExpExecArray | null;
      while ((m = metricRe.exec(hay)) !== null) {
        peak = Math.max(peak, parseFloat(m[1]) || 0);
      }
      out.stdout = `${hay.slice(-4000)}\npeak_${field}=${peak}`;
      if (condition === 'gte') out.ok = peak >= threshold;
      else if (condition === 'gt') out.ok = peak > threshold;
      else if (condition === 'lte') out.ok = peak <= threshold;
      else if (condition === 'lt') out.ok = peak < threshold;
      else out.ok = peak >= threshold;
      if (!out.ok) {
        out.error = `metric ${field} peak ${peak} did not satisfy ${condition} ${threshold}`;
      }
    } else {
      out.error = `unknown step type "${step.type}"`;
    }
  } catch (e) {
    const err = e as Record<string, unknown> & { message?: string };
    out.error = (e as Error).message;
    out.stderr = String(err.stderr || '');
    out.stdout = String(err.stdout || '');
  }

  if (out.ok && step.check) {
    const verdict = evaluateCheck({
      stdout: out.stdout,
      stderr: out.stderr,
      statusCode: out.statusCode,
      httpOk: out.ok,
    }, step.check);
    if (!verdict.ok) {
      out.ok = false;
      out.error = verdict.error || null;
    }
  }

  return out;
}

function extractResult(text: string): Partial<ValidationResult> | null {
  const m = /<validation_result>([\s\S]*?)<\/validation_result>/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch (_e) {
    return null;
  }
}

type OnLog = (payload: string | Record<string, unknown>) => void;

async function runLegacySteps({
  buildDir,
  portMap,
  validationSpec,
  log,
}: {
  buildDir: string;
  portMap: PortMap;
  validationSpec: { steps?: ValidationStep[]; metricsService?: string | null; [key: string]: unknown };
  log: (opts: string | Record<string, unknown>) => void;
}): Promise<EvidenceItem[]> {
  const steps = normalizeValidationSteps(validationSpec.steps || []);
  const metricsService = (validationSpec.metricsService as string | null) || null;
  const evidence: EvidenceItem[] = [];

  if (steps.length === 0) {
    log({
      level: 'warn',
      tag: 'validate',
      message: 'No validation checks defined — judge will rely on brokenState only',
    });
  } else {
    log({
      level: 'phase',
      tag: 'validate',
      message: `Running ${steps.length} validation check(s)`,
    });
  }

  for (const step of steps) {
    const label = step.type === 'http'
      ? `${step.service}${step.path || '/'}`
      : step.type === 'metricCheck'
        ? `metricCheck ${(step as ValidationStep & { field?: string }).field || 'errors'}`
        : `${step.service}: ${(Array.isArray(step.cmd) ? step.cmd : [step.cmd]).join(' ')}`;
    log({ level: 'info', tag: 'validate', message: `Step: ${step.type} → ${label}` });
    // eslint-disable-next-line no-await-in-loop
    const result = await runStep(buildDir, portMap, step, { metricsService });
    evidence.push(result);
    log({
      level: result.ok ? 'ok' : 'error',
      tag: 'validate',
      message: result.ok ? `✓ ${label}` : `✗ ${label}`,
      detail: result.error || (result.statusCode ? `status ${result.statusCode}` : null)
        || (result.stdout ? String(result.stdout).slice(0, 400) : null),
    });
  }
  return evidence;
}

async function runGraphValidation({
  buildDir,
  portMap,
  validationSpec,
  log,
}: {
  buildDir: string;
  portMap: PortMap;
  validationSpec: { graph?: ValidationGraphSpec; graphs?: ValidationGraphEntry[]; [key: string]: unknown };
  log: (opts: string | Record<string, unknown>) => void;
}): Promise<ValidationGraphSuiteResult> {
  const entries: ValidationGraphEntry[] = getValidationGraphEntries(validationSpec);
  const actionCount = entries.reduce(
    (n: number, e: ValidationGraphEntry) => n + Object.values(e.graph.nodes).filter(
      (node) => !['fork', 'join', 'wait', 'stop'].includes(node.type),
    ).length,
    0,
  );
  log({
    level: 'phase',
    tag: 'validate',
    message: `Running ${entries.length} validation graph(s) (${actionCount} action node(s)) — one per design symptom`,
  });

  return runValidationGraphSuite({
    buildDir,
    portMap,
    entries,
    onGraphStart: (entry: ValidationGraphEntry, index: number, total: number) => {
      log({
        level: 'phase',
        tag: 'validate',
        message: `Symptom ${entry.symptomId} (${index + 1}/${total})`,
        detail: entry.symptomCheck,
      });
    },
    onNodeStart: (nodeId: string, label: string, ctx: { symptomId: number | string }) => {
      log({
        level: 'info',
        tag: 'validate',
        message: `Graph [symptom ${ctx.symptomId}]: ${nodeId} → ${label}`,
      });
    },
    onNodeComplete: (snap: ValidationGraphNodeSnapshot) => {
      if (['fork', 'join', 'wait', 'stop'].includes(snap.type)) return;
      log({
        level: snap.ok ? 'ok' : 'error',
        tag: 'validate',
        message: snap.ok ? `✓ [${snap.symptomId}] ${snap.label}` : `✗ [${snap.symptomId}] ${snap.label}`,
        detail: snap.error || snap.snapshot || snap.body?.slice(0, 400) || null,
      });
    },
  });
}

async function validate({
  buildDir,
  portMap,
  sandboxSpec,
  draft,
  validationSpec,
  onLog,
}: {
  buildDir: string;
  portMap: PortMap;
  sandboxSpec?: Record<string, unknown>;
  draft?: ChallengeDraft;
  validationSpec?: { steps?: ValidationStep[]; graph?: ValidationGraphSpec; [key: string]: unknown } | null;
  onLog?: OnLog;
}): Promise<ValidationResult & { llmUsage?: unknown }> {
  const log = (opts: string | Record<string, unknown>): void => {
    if (!onLog) return;
    if (typeof opts === 'string') {
      onLog(opts);
      return;
    }
    emitLog(onLog, opts as { level?: string; tag?: string; message: string; detail?: unknown });
  };

  const normalized = draft ? normalizeDraft(draft) : null;
  const spec = sandboxSpec || normalized?.sandboxSpec || {};
  const broken = normalized?.brokenState || {};
  const useGraph = hasValidationGraph(validationSpec);

  let checklist: ChecklistItem[] = buildValidationChecklist(validationSpec);
  let evidence: EvidenceItem[] = [];
  let graphRun: ValidationGraphSuiteResult | null = null;

  if (useGraph && validationSpec) {
    graphRun = await runGraphValidation({
      buildDir,
      portMap,
      validationSpec,
      log,
    });
    if (graphRun.aborted) {
      log({
        level: 'error',
        tag: 'validate',
        message: `Validation graph aborted: ${graphRun.abortReason || 'unknown'}`,
      });
    }
  } else {
    evidence = await runLegacySteps({
      buildDir,
      portMap,
      validationSpec: validationSpec || {},
      log,
    });
  }

  if (!llm.isConfigured()) {
    const provider = llm.getProvider();
    const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    let passed = false;
    let feedback = '';
    if (graphRun) {
      passed = !graphRun.aborted && graphRun.snapshots.some((s) => s.ok);
      feedback = passed
        ? `Validation graph completed (LLM judge skipped — no ${keyName}).`
        : `Validation graph failed or aborted. Configure ${keyName} for judge.`;
      checklist = applyGraphValidationResults(checklist, { snapshots: graphRun.snapshots, passed, feedback });
    } else {
      passed = evidence.length > 0 && evidence.every((e) => e.ok);
      feedback = passed
        ? `Validation checks passed (LLM judge skipped — no ${keyName}).`
        : `Validation checks failed. Configure ${keyName} for richer feedback.`;
      checklist = applyValidationResults(checklist, { evidence: evidence as unknown as Array<Record<string, unknown>>, passed, feedback });
    }
    return {
      passed,
      feedback,
      suggestions: [],
      evidence: graphRun
        ? (graphRun.snapshots as unknown as Array<Record<string, unknown>>)
        : (evidence as unknown as Array<Record<string, unknown>>),
      checklist,
    };
  }

  const userMessage = JSON.stringify({
    brokenState: (spec as Record<string, unknown>).brokenState || broken.rootCause || '(not specified)',
    validationApproach: (spec as Record<string, unknown>).validationApproach
      || normalized?.sandboxSpec?.validationApproach
      || '(not specified)',
    expectBroken: graphRun ? graphRun.expectBroken : true,
    coverageGoals: graphRun?.coverageGoals || [],
    graphRun: graphRun
      ? {
        aborted: graphRun.aborted,
        abortReason: graphRun.abortReason,
        expectBroken: graphRun.expectBroken,
        coverageGoals: graphRun.coverageGoals,
        graphs: graphRun.graphs.map((g) => ({
          symptomId: g.symptomId,
          symptomCheck: g.symptomCheck,
          aborted: g.aborted,
          abortReason: g.abortReason,
          snapshots: g.snapshots.map((s) => ({
            nodeId: s.nodeId,
            type: s.type,
            label: s.label,
            ok: s.ok,
            error: s.error,
            snapshot: s.snapshot,
            body: s.body?.slice(0, 4000),
            stdout: s.stdout?.slice(0, 4000),
            statusCode: s.statusCode,
          })),
        })),
        snapshots: graphRun.snapshots.map((s) => ({
          symptomId: s.symptomId,
          symptomCheck: s.symptomCheck,
          nodeId: s.nodeId,
          type: s.type,
          label: s.label,
          ok: s.ok,
          error: s.error,
          snapshot: s.snapshot,
          body: s.body?.slice(0, 4000),
          stdout: s.stdout?.slice(0, 4000),
          statusCode: s.statusCode,
        })),
        nodeOutcomes: Object.fromEntries(
          graphRun.snapshots.map((s) => [`${s.symptomId}:${s.nodeId}`, { ok: s.ok, error: s.error }]),
        ),
      }
      : null,
    evidence: graphRun
      ? undefined
      : evidence.map((e) => ({
        step: e.step,
        ok: e.ok,
        statusCode: e.statusCode,
        stdout: (e.stdout || '').slice(0, 4000),
        stderr: (e.stderr || '').slice(0, 1000),
        error: e.error,
      })),
  }, null, 2);

  log({ level: 'phase', tag: 'validate', message: 'Asking validation judge to evaluate snapshots…' });
  const llmResult = await llm.completeMessage({
    agent: 'validation',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 1024,
  });
  const text: string = llmResult.text;

  const fallbackPassed = graphRun
    ? !graphRun.aborted
    : evidence.every((e) => e.ok);
  const parsed: Partial<ValidationResult> = extractResult(text) || {
    passed: fallbackPassed,
    feedback: 'Could not parse LLM judge output; fell back to runner outcomes.',
    suggestions: [],
  };

  if (graphRun) {
    (parsed as Record<string, unknown>).evidence = graphRun.snapshots as unknown as Record<string, unknown>[];
    (parsed as Record<string, unknown>).checklist = applyGraphValidationResults(checklist, {
      snapshots: graphRun.snapshots,
      passed: parsed.passed!,
      feedback: parsed.feedback,
    });
  } else {
    (parsed as Record<string, unknown>).evidence = evidence as unknown as Record<string, unknown>[];
    (parsed as Record<string, unknown>).checklist = applyValidationResults(checklist, {
      evidence,
      passed: parsed.passed!,
      feedback: parsed.feedback,
    });
  }

  log({
    level: parsed.passed ? 'ok' : 'error',
    tag: 'validate',
    message: parsed.passed ? 'Judge: PASS' : 'Judge: FAIL',
    detail: parsed.feedback,
  });

  return {
    ...(parsed as ValidationResult),
    llmUsage: {
      agent: 'validation',
      label: 'judge',
      modelId: llmResult.modelId,
      usage: llmResult.usage,
    },
  };
}

module.exports = { validate, runStep, SYSTEM_PROMPT };
