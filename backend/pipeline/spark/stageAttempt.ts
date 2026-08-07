'use strict';

/**
 * Stage attempt helpers — sanitize prior failures for Data/Code/Eval retries.
 */

import type { SparkPipelinePhase, SparkStageAttempt } from '../../types/sparkShape';

function cap(s: unknown, max: number): string | null {
  if (s == null) return null;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated ${str.length - max} chars]`;
}

function sanitizePreviousStageForRetry(
  prev: SparkStageAttempt | null | undefined,
): SparkStageAttempt | null {
  if (!prev?.phase) return null;
  const details = prev.details && typeof prev.details === 'object'
    ? { ...prev.details }
    : null;
  if (details) {
    for (const key of Object.keys(details)) {
      const v = details[key];
      if (typeof v === 'string') details[key] = cap(v, 4000);
    }
  }
  return {
    phase: prev.phase,
    message: cap(prev.message, 1200) || String(prev.phase),
    details,
    rawText: cap(prev.rawText, 2000),
  };
}

function formatPreviousStageForPrompt(
  prev: SparkStageAttempt | null | undefined,
): string {
  const clean = sanitizePreviousStageForRetry(prev);
  if (!clean) return '';
  const detailsJson = clean.details
    ? JSON.stringify(clean.details, null, 2)
    : '';
  // Pull stderr/stdout from details when present — repair agents need the traceback
  const stderr = clean.details && typeof clean.details.stderr === 'string'
    ? clean.details.stderr
    : '';
  const stdout = clean.details && typeof clean.details.stdout === 'string'
    ? clean.details.stdout
    : '';
  const repairOwner = clean.details && typeof clean.details.repairOwner === 'string'
    ? clean.details.repairOwner
    : '';
  return [
    '## Previous stage failure (fix this on retry — do not ignore)',
    `phase: ${clean.phase}`,
    repairOwner ? `repairOwner: ${repairOwner}` : '',
    `message: ${clean.message}`,
    stderr ? `driver_stderr (focus on Traceback / TypeError / AnalysisException):\n\`\`\`\n${stderr.slice(-3000)}\n\`\`\`` : '',
    stdout && !stderr ? `driver_stdout:\n\`\`\`\n${stdout.slice(-2000)}\n\`\`\`` : '',
    detailsJson ? `details:\n\`\`\`json\n${detailsJson.slice(0, 4000)}\n\`\`\`` : '',
    clean.rawText ? `raw:\n${clean.rawText}` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * Infra / platform failures are NOT agent bugs — do not hand to Data or Code.
 * (K8s API down, kubectl dial errors, Spark platform API unreachable, etc.)
 */
function isPlatformInfraFailure(...parts: Array<string | null | undefined>): boolean {
  const text = parts.filter(Boolean).join('\n');
  if (!text) return false;
  // Python / Spark app errors → agent repair, even if the word "connection" appears
  if (/Traceback \(most recent call last\)|AnalysisException|ArrowInvalid|pyspark|generate\.py|TypeError:|ValueError:|Decimal/i.test(text)
    && !/Kubernetes API unreachable|kubectl|cluster-info|KUBECONFIG/i.test(text)) {
    return false;
  }
  return /Kubernetes API unreachable|data-gen Jobs cannot be submitted|Start\/reconnect the cluster|connection refused|dial tcp|i\/o timeout|Temporary failure in name resolution|no such host|failed to download openapi|couldn't get current server API group list|The connection to the server .+ was refused|ECONNREFUSED|fetch failed|platform submit failed|SPARK_PLATFORM_API|Network is unreachable|connect: connection refused/i.test(text);
}

/**
 * Decide which authoring agents to re-run after a failure.
 * Prefers Eval's details.repairOwner (DATA | CODE | EVAL | PLATFORM); falls back to phase/step.
 */
function resolveRepairTargets(
  prior: SparkStageAttempt | null | undefined,
): { runData: boolean; runCode: boolean; owner: 'DATA' | 'CODE' | 'BOTH' | 'NONE' } {
  if (!prior?.phase) {
    return { runData: true, runCode: true, owner: 'BOTH' };
  }

  const details = prior.details && typeof prior.details === 'object'
    ? prior.details as Record<string, unknown>
    : {};
  const rawOwner = String(details.repairOwner || '').toUpperCase();
  const step = String(details.step || '').toLowerCase();
  const blob = [
    prior.message,
    typeof details.stderr === 'string' ? details.stderr : '',
    typeof details.stdout === 'string' ? details.stdout : '',
    prior.rawText,
  ].join('\n');

  // Platform / infra — skip agents; Retry re-runs Eval only
  if (
    rawOwner === 'PLATFORM'
    || rawOwner === 'INFRA'
    || rawOwner === 'NONE'
    || isPlatformInfraFailure(blob)
  ) {
    return { runData: false, runCode: false, owner: 'NONE' };
  }

  // Explicit Eval handoff (only when owner set — do not infer DATA solely from step=data_gen
  // when the failure was already classified as PLATFORM above)
  if (rawOwner === 'DATA') {
    return { runData: true, runCode: false, owner: 'DATA' };
  }
  if (rawOwner === 'CODE') {
    return { runData: false, runCode: true, owner: 'CODE' };
  }
  // Collect / plumbing — re-run both lightly (output schema often Code; rare)
  if (rawOwner === 'EVAL' || step === 'collect') {
    return { runData: true, runCode: true, owner: 'BOTH' };
  }

  // Step fallback when repairOwner missing
  if (step === 'data_gen' || step === 'generate') {
    return { runData: true, runCode: false, owner: 'DATA' };
  }
  if (step === 'solution') {
    return { runData: false, runCode: true, owner: 'CODE' };
  }

  // Phase from earlier stages
  if (prior.phase === 'DATA') {
    return { runData: true, runCode: false, owner: 'DATA' };
  }
  if (prior.phase === 'CODE') {
    return { runData: false, runCode: true, owner: 'CODE' };
  }
  if (prior.phase === 'VALIDATION' || prior.phase === 'EVAL') {
    return { runData: true, runCode: true, owner: 'BOTH' };
  }

  return { runData: true, runCode: true, owner: 'BOTH' };
}

const STAGE_FAILURE_FILE = 'eval-failure.json';

/** Persist last stage failure for cross-request Retry (repair mode). */
function writeSparkStageFailure(
  evalDir: string,
  attempt: SparkStageAttempt,
): string {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  fs.mkdirSync(evalDir, { recursive: true });
  const p = path.join(evalDir, STAGE_FAILURE_FILE);
  const details = attempt.details && typeof attempt.details === 'object'
    ? attempt.details as Record<string, unknown>
    : {};
  fs.writeFileSync(p, `${JSON.stringify({
    ok: false,
    phase: attempt.phase,
    step: details.step || null,
    repairOwner: details.repairOwner || null,
    where: details.where || null,
    message: attempt.message,
    stderr: typeof details.stderr === 'string' ? details.stderr : null,
    stdout: typeof details.stdout === 'string' ? details.stdout : null,
    rawText: attempt.rawText,
    details,
    at: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  return p;
}

/**
 * Load prior failure for a Retry POST — prefers eval/eval-failure.json, else draft hints.
 */
function loadSparkStageFailure(
  evalDir: string,
  hints?: { phase?: string | null; message?: string | null } | null,
): SparkStageAttempt | null {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const reportPath = path.join(evalDir, STAGE_FAILURE_FILE);
  if (fs.existsSync(reportPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
      const message = String(report.message || hints?.message || 'previous stage failure');
      const details = {
        step: report.step || null,
        repairOwner: report.repairOwner || null,
        where: report.where || null,
        stderr: report.stderr || null,
        stdout: report.stdout || null,
        ...(report.details && typeof report.details === 'object'
          ? report.details as Record<string, unknown>
          : {}),
      };
      return {
        phase: String(report.phase || hints?.phase || 'EVAL') as SparkStageAttempt['phase'],
        message,
        details,
        rawText: report.rawText != null
          ? String(report.rawText)
          : (typeof report.stderr === 'string' ? report.stderr : null),
      };
    } catch (_e) { /* fall through */ }
  }
  if (hints?.message || hints?.phase) {
    return makeStageAttempt(
      (hints.phase || 'EVAL') as SparkPipelinePhase,
      hints.message || `Previous ${hints.phase || 'EVAL'} failure`,
      { repairOwner: hints.phase === 'DATA' ? 'DATA' : hints.phase === 'CODE' ? 'CODE' : null },
    );
  }
  return null;
}

function makeStageAttempt(
  phase: SparkPipelinePhase,
  message: string,
  details?: Record<string, unknown> | null,
  rawText?: string | null,
): SparkStageAttempt {
  return {
    phase,
    message,
    details: details || null,
    rawText: rawText || null,
  };
}

module.exports = {
  sanitizePreviousStageForRetry,
  formatPreviousStageForPrompt,
  isPlatformInfraFailure,
  resolveRepairTargets,
  writeSparkStageFailure,
  loadSparkStageFailure,
  makeStageAttempt,
};
