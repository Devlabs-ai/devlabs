'use strict';

// Validation Agent — runs the mechanical validationSpec.steps against a
// running build and then asks Claude to judge the collected evidence.

import type { ChallengeDraft, PortMap, ValidationResult, ValidationStep, ChecklistItem } from '../../types/domain';

const composeManager = require('../../sandbox/composeManager');
const llm = require('../../llm/client');
const { evaluateCheck } = require('../validation/validationChecks');
const { normalizeDraft } = require('../draft/draftSchema');
const { emitLog } = require('../build/buildLogger');
const {
  buildValidationChecklist,
  applyValidationResults,
} = require('../validation/validationChecklist');
const { SYSTEM_PROMPT } = require('../prompts/validationAgent.prompt');

interface EvidenceItem {
  step: ValidationStep;
  ok: boolean;
  stdout: string;
  stderr: string;
  error: string | null;
  statusCode: number | null;
}

async function runStep(
  buildDir: string,
  portMap: PortMap,
  step: ValidationStep,
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
      const { stdout, stderr } = await composeManager.exec(buildDir, step.service, cmd, { portMap });
      out.stdout = stdout;
      out.stderr = stderr;
      out.ok = true;
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
  validationSpec?: { steps?: ValidationStep[]; [key: string]: unknown } | null;
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
  const symptoms = broken.validationSymptoms || [];

  const steps: ValidationStep[] = (validationSpec && validationSpec.steps) || [];
  const evidence: EvidenceItem[] = [];
  let checklist: ChecklistItem[] = buildValidationChecklist(normalized, validationSpec);

  if (steps.length === 0) {
    log({
      level: 'warn',
      tag: 'validate',
      message: 'No mechanical validation steps — judge will rely on symptoms only',
      detail: { symptomCount: symptoms.length },
    });
  } else {
    log({
      level: 'phase',
      tag: 'validate',
      message: `Running ${steps.length} mechanical check(s) + ${symptoms.length} design symptom(s)`,
    });
  }

  for (const step of steps) {
    const label = step.type === 'http'
      ? `${step.service}${step.path || '/'}`
      : `${step.service}: ${(Array.isArray(step.cmd) ? step.cmd : [step.cmd]).join(' ')}`;
    log({ level: 'info', tag: 'validate', message: `Step: ${step.type} → ${label}` });
    // eslint-disable-next-line no-await-in-loop
    const result = await runStep(buildDir, portMap, step);
    evidence.push(result);
    log({
      level: result.ok ? 'ok' : 'error',
      tag: 'validate',
      message: result.ok ? `✓ ${label}` : `✗ ${label}`,
      detail: result.error || (result.statusCode ? `status ${result.statusCode}` : null)
        || (result.stdout ? String(result.stdout).slice(0, 400) : null),
    });
  }

  if (!llm.isConfigured()) {
    const allOk = evidence.length > 0 && evidence.every((e) => e.ok);
    const provider = llm.getProvider();
    const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    const passed = allOk;
    const feedback = passed
      ? `Mechanical validation passed (LLM judge skipped — no ${keyName}).`
      : `Mechanical validation failed. Configure ${keyName} for richer feedback.`;
    checklist = applyValidationResults(checklist, { evidence: evidence as unknown as Array<Record<string, unknown>>, passed, feedback });
    return {
      passed,
      feedback,
      suggestions: [],
      evidence: evidence as unknown as Array<Record<string, unknown>>,
      checklist,
    };
  }

  const userMessage = JSON.stringify({
    brokenState: (spec as Record<string, unknown>).brokenState || broken.rootCause || '(not specified)',
    validationApproach: (spec as Record<string, unknown>).validationApproach
      || symptoms.map((s: Record<string, unknown>) => s.check).filter(Boolean).join('; ')
      || '(not specified)',
    validationSymptoms: symptoms,
    evidence: evidence.map((e) => ({
      step: e.step,
      ok: e.ok,
      statusCode: e.statusCode,
      stdout: (e.stdout || '').slice(0, 4000),
      stderr: (e.stderr || '').slice(0, 1000),
      error: e.error,
    })),
  }, null, 2);

  log({ level: 'phase', tag: 'validate', message: 'Asking validation judge to evaluate evidence…' });
  const llmResult = await llm.completeMessage({
    agent: 'validation',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 1024,
  });
  const text: string = llmResult.text;

  const parsed: Partial<ValidationResult> = extractResult(text) || {
    passed: evidence.every((e) => e.ok),
    feedback: 'Could not parse LLM judge output; fell back to mechanical check.',
    suggestions: [],
  };
  (parsed as Record<string, unknown>).evidence = evidence as unknown as Record<string, unknown>[];
  (parsed as Record<string, unknown>).checklist = applyValidationResults(checklist, {
    evidence,
    passed: parsed.passed!,
    feedback: parsed.feedback,
  });
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
