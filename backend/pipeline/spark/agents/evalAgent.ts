'use strict';

/**
 * Spark Eval Agent — execute only (never edits gen/ or solution/).
 *
 * 1. DATA_GEN  — run generate.py (K8s Job → MinIO by default)
 * 2. SOLUTION  — run solution/ on Spark platform (or local fallback)
 * 3. COLLECT   — download/parse result JSON → layout.eval/
 *
 * On failure: descriptive logs + SparkStageAttempt with stderr for Data/Code repair.
 * Does NOT call Claude and does NOT rewrite gen/starter/solution.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type { BuildEventHandler } from '../../../types/domain';
import type {
  SparkShapeContract,
  SparkStageAttempt,
  SparkWorkspaceLayout,
} from '../../../types/sparkShape';

const { makeStageAttempt, isPlatformInfraFailure } = require('../stageAttempt');
const { runSolutionOnPlatform, platformEvalAvailable } = require('../platformEval');
const { runAuthoringDataGenJob, k8sDataGenAvailable, dataGenMode } = require('../dataGenJob');

export interface SparkEvalResult {
  passed: boolean;
  evalPath: string | null;
  message: string;
  attempt: SparkStageAttempt | null;
}

type EvalStep = 'data_gen' | 'solution' | 'collect';
type RepairOwner = 'DATA' | 'CODE' | 'EVAL' | 'PLATFORM';

const STEP_META: Record<EvalStep, { n: number; label: string; repairOwner: RepairOwner }> = {
  data_gen: { n: 1, label: 'DATA_GEN', repairOwner: 'DATA' },
  solution: { n: 2, label: 'SOLUTION', repairOwner: 'CODE' },
  collect: { n: 3, label: 'COLLECT', repairOwner: 'EVAL' },
};

function emit(
  onEvent: BuildEventHandler | undefined,
  level: 'info' | 'warn' | 'error' | 'ok',
  message: string,
  detail?: unknown,
): void {
  onEvent?.({
    type: 'log',
    level,
    tag: 'spark_eval',
    message,
    ...(detail !== undefined ? { detail } : {}),
  } as never);
}

function emitStep(onEvent: BuildEventHandler | undefined, step: EvalStep, note?: string): void {
  const m = STEP_META[step];
  emit(
    onEvent,
    'info',
    `[EVAL STEP ${m.n}/3 · ${m.label}] ${note || 'starting'}`,
  );
}

function interestingLines(text: string, max = 60): string {
  if (!text) return '';
  const lines = text.split('\n');
  const hit = lines.filter((line) =>
    /Traceback|Error|Exception|Caused by|TypeError|ArrowInvalid|AnalysisException|FileNotFound|generate\.py|main\.py|FAILED|Error:/i.test(line),
  );
  const picked = (hit.length ? hit : lines).slice(-max);
  return picked.join('\n').trim();
}

function writeFailureReport(
  layout: SparkWorkspaceLayout,
  payload: Record<string, unknown>,
): string {
  fs.mkdirSync(layout.eval, { recursive: true });
  const p = path.join(layout.eval, 'eval-failure.json');
  fs.writeFileSync(p, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return p;
}

function failStep(
  onEvent: BuildEventHandler | undefined,
  layout: SparkWorkspaceLayout,
  step: EvalStep,
  message: string,
  extras: {
    stdout?: string;
    stderr?: string;
    where?: string;
    outputPath?: string;
  } = {},
): SparkEvalResult {
  const meta = STEP_META[step];
  const stdout = extras.stdout || '';
  const stderr = extras.stderr || '';
  const interesting = interestingLines(stderr || stdout) || (stderr || stdout || message).slice(-2500);
  const where = extras.where || step;

  // K8s/API down ≠ broken generate.py / solution — do not hand to Data/Code agents
  const repairOwner: RepairOwner = isPlatformInfraFailure(message, stderr, stdout, where)
    ? 'PLATFORM'
    : meta.repairOwner;

  emit(onEvent, 'error', `[EVAL FAILED · STEP ${meta.n}/3 · ${meta.label}] where=${where}`);
  emit(onEvent, 'error', `[EVAL FAILED · ${meta.label}] ${message}`);
  if (interesting) {
    const handoffHint = repairOwner === 'PLATFORM'
      ? 'platform/infra — fix cluster or network, then Retry Eval (no agent rewrite)'
      : `give this to ${repairOwner} Agent`;
    emit(
      onEvent,
      'error',
      `[EVAL ERROR DETAIL · ${meta.label}] (${handoffHint})\n${interesting}`,
    );
  }
  if (repairOwner === 'PLATFORM') {
    emit(
      onEvent,
      'info',
      `[EVAL HANDOFF] repairOwner=PLATFORM — infra/cluster failure; skipping Data/Code agents. Fix K8s/platform, then Retry.`,
    );
  } else {
    emit(
      onEvent,
      'info',
      `[EVAL HANDOFF] repairOwner=${repairOwner} — Eval did not modify gen/ or solution/`,
    );
  }

  const attempt = makeStageAttempt(
    'EVAL',
    `[${meta.label}] ${message}`,
    {
      step,
      repairOwner,
      where,
      stdout: stdout.slice(-4000),
      stderr: (interesting || stderr).slice(-4000),
      outputPath: extras.outputPath || null,
    },
    (interesting || stderr || message).slice(-4000),
  );

  const reportPath = writeFailureReport(layout, {
    ok: false,
    step,
    repairOwner,
    where,
    message: attempt.message,
    stderr: attempt.details?.stderr || null,
    stdout: attempt.details?.stdout || null,
    rawText: attempt.rawText,
    at: new Date().toISOString(),
  });
  emit(onEvent, 'info', `[EVAL] wrote failure report → ${reportPath}`);

  return {
    passed: false,
    evalPath: null,
    message: attempt.message,
    attempt,
  };
}

function findGenerateEntrypoint(genDir: string): string | null {
  const candidates = ['generate.py', 'generate.sh', 'main.py'];
  for (const c of candidates) {
    const p = path.join(genDir, c);
    if (fs.existsSync(p)) return p;
  }
  const files = fs.existsSync(genDir) ? fs.readdirSync(genDir) : [];
  const py = files.find((f) => f.endsWith('.py'));
  return py ? path.join(genDir, py) : null;
}

function runGenerateLocal(
  contract: SparkShapeContract,
  layout: SparkWorkspaceLayout,
  onEvent?: BuildEventHandler,
): { ok: boolean; message: string; stdout: string; stderr: string; where: string } {
  const entry = findGenerateEntrypoint(layout.gen);
  if (!entry) {
    return {
      ok: false,
      message: 'No generate.py (or similar) in gen/',
      stdout: '',
      stderr: '',
      where: 'local:gen/',
    };
  }

  const outPrefix = layout.input;
  fs.mkdirSync(outPrefix, { recursive: true });

  emit(
    onEvent,
    'info',
    `[DATA_GEN] local python ${path.basename(entry)} → OUTPUT_PREFIX=${outPrefix}`,
  );

  const env = {
    ...process.env,
    OUTPUT_PREFIX: outPrefix,
    OUTPUT_DIR: outPrefix,
    INPUT_OUTPUT_DIR: outPrefix,
    BUSINESS_DATE: contract.data.businessDate || '',
    TARGET_PREFIX: contract.data.inputLayout?.targetPrefixHint || '',
  };

  const isPy = entry.endsWith('.py');
  const cmd = isPy ? (process.env.SPARK_EVAL_PYTHON || 'python3') : entry;
  const args = isPy ? [entry] : [];
  const res = spawnSync(cmd, args, {
    cwd: layout.gen,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: Number(process.env.SPARK_EVAL_GEN_TIMEOUT_MS || 10 * 60 * 1000),
  });

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  if (res.error) {
    return { ok: false, message: res.error.message, stdout, stderr, where: 'local:generate' };
  }
  if (res.status !== 0) {
    return {
      ok: false,
      message: `generate exited ${res.status}: ${stderr.slice(-800) || stdout.slice(-800)}`,
      stdout,
      stderr,
      where: 'local:generate',
    };
  }
  return { ok: true, message: 'generate ok (local)', stdout, stderr, where: 'local:generate' };
}

async function runGenerate(
  contract: SparkShapeContract,
  layout: SparkWorkspaceLayout,
  draftSessionId: string | undefined,
  onEvent?: BuildEventHandler,
): Promise<{ ok: boolean; message: string; stdout: string; stderr: string; where: string }> {
  const mode = dataGenMode() as 'k8s' | 'local';
  const preferK8s = mode === 'k8s' && Boolean(draftSessionId) && k8sDataGenAvailable();

  if (preferK8s) {
    emit(onEvent, 'info', '[DATA_GEN] mode=k8s — Job image runs generate.py; Parquet → MinIO input/');
    const job = await runAuthoringDataGenJob({
      contract,
      layout,
      draftSessionId: draftSessionId!,
      onLog: (msg: string) => emit(onEvent, 'info', `[DATA_GEN] ${msg}`),
    });
    // Prefer Job container logs (traceback) over kubectl describe fluff
    const logs = (job.stdout || job.stderr || '').trim();
    return {
      ok: job.ok,
      message: job.message,
      stdout: job.stdout || '',
      stderr: logs || job.message,
      where: job.jobName ? `k8s:job/${job.jobName}` : 'k8s:data-gen',
    };
  }

  if (mode === 'k8s' && !preferK8s) {
    emit(
      onEvent,
      'warn',
      '[DATA_GEN] K8s unavailable (kubectl/draft id) — falling back to local generate',
    );
  }

  return runGenerateLocal(contract, layout, onEvent);
}

function findSolutionEntrypoint(solutionDir: string, starterFileName: string): string | null {
  const preferred = path.join(solutionDir, starterFileName);
  if (fs.existsSync(preferred)) return preferred;
  const alt = path.join(solutionDir, 'src', 'main.py');
  if (fs.existsSync(alt)) return alt;
  return null;
}

function runSolution(
  contract: SparkShapeContract,
  layout: SparkWorkspaceLayout,
  onEvent?: BuildEventHandler,
): { ok: boolean; message: string; outputPath: string; stdout: string; stderr: string; where: string } {
  const outputPath = path.join(layout.eval, 'job-output.json');
  fs.mkdirSync(layout.eval, { recursive: true });

  const custom = process.env.SPARK_EVAL_SOLUTION_CMD;
  if (custom) {
    emit(onEvent, 'info', '[SOLUTION] SPARK_EVAL_SOLUTION_CMD (shell)');
    const res = spawnSync(custom, {
      shell: true,
      cwd: layout.solution,
      env: {
        ...process.env,
        INPUT_PATH: layout.input,
        OUTPUT_PATH: outputPath,
        BUSINESS_DATE: contract.data.businessDate || '',
      },
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: Number(process.env.SPARK_EVAL_SOLUTION_TIMEOUT_MS || 20 * 60 * 1000),
    });
    return {
      ok: res.status === 0 && !res.error,
      message: res.error?.message || (res.status === 0 ? 'solution ok' : `solution exited ${res.status}`),
      outputPath,
      stdout: res.stdout || '',
      stderr: res.stderr || '',
      where: 'local:SPARK_EVAL_SOLUTION_CMD',
    };
  }

  const entry = findSolutionEntrypoint(layout.solution, contract.platform.starterFileName);
  if (!entry) {
    return {
      ok: false,
      message: `solution entrypoint missing: ${contract.platform.starterFileName}`,
      outputPath,
      stdout: '',
      stderr: '',
      where: 'local:solution/',
    };
  }

  emit(onEvent, 'info', `[SOLUTION] local python ${path.relative(layout.solution, entry)}`);

  const res = spawnSync(process.env.SPARK_EVAL_PYTHON || 'python3', [entry], {
    cwd: layout.solution,
    env: {
      ...process.env,
      INPUT_PATH: layout.input,
      OUTPUT_PATH: outputPath,
      BUSINESS_DATE: contract.data.businessDate || '',
    },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: Number(process.env.SPARK_EVAL_SOLUTION_TIMEOUT_MS || 20 * 60 * 1000),
  });

  return {
    ok: res.status === 0 && !res.error && fs.existsSync(outputPath),
    message: res.error?.message
      || (res.status === 0
        ? (fs.existsSync(outputPath) ? 'solution ok' : 'solution ran but OUTPUT_PATH missing')
        : `solution exited ${res.status}: ${(res.stderr || '').slice(-800)}`),
    outputPath,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    where: 'local:python',
  };
}

function collectEvalArtifact(
  contract: SparkShapeContract,
  jobOutputPath: string,
  layout: SparkWorkspaceLayout,
): { ok: boolean; evalPath: string | null; message: string } {
  const publishName = path.basename(contract.evalCollection.publishAs) || 'solution.json';
  const evalPath = path.join(layout.eval, publishName);

  if (!fs.existsSync(jobOutputPath)) {
    return { ok: false, evalPath: null, message: 'job output missing' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(jobOutputPath, 'utf8'));
  } catch (e) {
    return { ok: false, evalPath: null, message: `invalid JSON: ${(e as Error).message}` };
  }

  const wrapper = contract.evalCollection.fromJob.wrapper || 'rows';
  const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  const rows = obj && Array.isArray(obj[wrapper]) ? obj[wrapper] : null;
  if (!rows) {
    return { ok: false, evalPath: null, message: `missing wrapper "${wrapper}" in job output` };
  }

  const golden = {
    challenge: contract.meta.slug,
    business_date: contract.data.businessDate || null,
    keys: contract.evalCollection.keys,
    columns: contract.evalCollection.columns,
    row_count: rows.length,
    rows,
  };
  fs.writeFileSync(evalPath, `${JSON.stringify(golden, null, 2)}\n`, 'utf8');
  return { ok: true, evalPath, message: `wrote ${publishName} (${rows.length} rows)` };
}

async function runSparkEvalAgent({
  contract,
  layout,
  draftSessionId,
  onEvent,
}: {
  contract: SparkShapeContract;
  layout: SparkWorkspaceLayout;
  draftSessionId?: string;
  onEvent?: BuildEventHandler;
}): Promise<SparkEvalResult> {
  emit(
    onEvent,
    'info',
    'Eval Agent — execute only (will NOT edit gen/ or solution/). Steps: DATA_GEN → SOLUTION → COLLECT',
  );

  // --- STEP 1: data gen -----------------------------------------------------
  emitStep(onEvent, 'data_gen', 'run generate.py (cluster Job or local)');
  const gen = await runGenerate(contract, layout, draftSessionId, onEvent);
  if (!gen.ok) {
    return failStep(onEvent, layout, 'data_gen', gen.message, {
      stdout: gen.stdout,
      stderr: gen.stderr,
      where: gen.where,
    });
  }
  emit(onEvent, 'ok', `[EVAL STEP 1/3 · DATA_GEN] OK — ${gen.message}`);

  // --- STEP 2: solution -----------------------------------------------------
  emitStep(onEvent, 'solution', 'run solution/ against generated input');
  let sol: {
    ok: boolean;
    message: string;
    outputPath: string;
    stdout: string;
    stderr: string;
    where: string;
  };

  const usePlatform = platformEvalAvailable()
    && process.env.SPARK_EVAL_SOLUTION_CMD !== 'local'
    && Boolean(draftSessionId);

  if (usePlatform) {
    emit(onEvent, 'info', '[SOLUTION] mode=spark-platform — submit Job via SPARK_PLATFORM_API_URL');
    const platform = await runSolutionOnPlatform({
      contract,
      layout,
      draftSessionId: draftSessionId!,
      onLog: (msg: string) => emit(onEvent, 'info', `[SOLUTION] ${msg}`),
    });
    sol = {
      ...platform,
      where: 'spark-platform',
    };
  } else if (process.env.SPARK_EVAL_SOLUTION_CMD) {
    sol = runSolution(contract, layout, onEvent);
  } else {
    sol = runSolution(contract, layout, onEvent);
  }

  if (!sol.ok) {
    return failStep(onEvent, layout, 'solution', sol.message, {
      stdout: sol.stdout,
      stderr: sol.stderr,
      where: sol.where,
      outputPath: sol.outputPath,
    });
  }
  emit(onEvent, 'ok', `[EVAL STEP 2/3 · SOLUTION] OK — ${sol.message}`);

  // --- STEP 3: collect golden -----------------------------------------------
  emitStep(onEvent, 'collect', 'parse job output → layout.eval/ golden JSON');
  const collected = collectEvalArtifact(contract, sol.outputPath, layout);
  if (!collected.ok) {
    return failStep(onEvent, layout, 'collect', collected.message, {
      where: 'local:eval/',
      outputPath: sol.outputPath,
      stderr: collected.message,
    });
  }

  emit(onEvent, 'ok', `[EVAL STEP 3/3 · COLLECT] OK — ${collected.message}`);
  emit(onEvent, 'ok', `[EVAL PASSED] ${collected.evalPath}`);

  return {
    passed: true,
    evalPath: collected.evalPath,
    message: collected.message,
    attempt: null,
  };
}

module.exports = { runSparkEvalAgent };
