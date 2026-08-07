'use strict';

/**
 * Spark authoring pipeline orchestrator.
 *
 *   Design (shape confirmed) →
 *     Data Agent →
 *     Code Agent →
 *     Validation Agent →
 *     Eval Agent (run gen + solution + collect)
 *
 * Retries carry SparkStageAttempt errors into the next pass.
 * On retry, repairOwner (from Eval) / phase selects Data-only, Code-only, or both.
 * Compose buildPipeline is untouched.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { BuildEventHandler } from '../../types/domain';
import type {
  SparkShapeContract,
  SparkStageAttempt,
} from '../../types/sparkShape';

const {
  normalizeSparkShapeContract,
  validateSparkShapeContract,
} = require('./shapeContract');
const { ensureSparkWorkspace, writeShapeLock } = require('./workspace');
const { makeStageAttempt, resolveRepairTargets, writeSparkStageFailure } = require('./stageAttempt');
const { runSparkDataAgent } = require('./agents/dataAgent');
const { runSparkCodeAgent } = require('./agents/codeAgent');
const { runSparkValidationAgent } = require('./agents/validationAgent');
const { runSparkEvalAgent } = require('./agents/evalAgent');
const { syncAuthoringAssetsToMinio } = require('./authoringMinio');

const MAX_ITERATIONS = Math.max(1, Number(process.env.SPARK_PIPELINE_MAX_ITERATIONS || 2));

export interface SparkPipelineResult {
  passed: boolean;
  draftSessionId: string;
  workspaceRoot: string;
  contract: SparkShapeContract;
  attempts: number;
  evalPath: string | null;
  lastAttempt: SparkStageAttempt | null;
  message: string;
}

function emitLog(
  onEvent: BuildEventHandler | undefined,
  message: string,
  detail?: unknown,
  level = 'info',
): void {
  onEvent?.({ type: 'log', level, tag: 'spark_pipeline', message, detail } as never);
  console.log(`[spark_pipeline] ${message}`);
}

function dirHasPy(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  const walk = (d: string): boolean => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        if (walk(full)) return true;
      } else if (name.endsWith('.py')) {
        return true;
      }
    }
    return false;
  };
  return walk(dir);
}

async function runSparkAuthoringPipeline({
  draftSessionId,
  shape,
  contract: contractIn,
  onEvent,
  maxIterations = MAX_ITERATIONS,
  /** Seed from a prior failed POST /build (Retry → repair mode). */
  previousAttempt = null,
}: {
  draftSessionId: string;
  shape?: unknown;
  /** Already-normalized contract (preferred when caller validated). */
  contract?: SparkShapeContract | null;
  onEvent?: BuildEventHandler;
  maxIterations?: number;
  previousAttempt?: SparkStageAttempt | null;
}): Promise<SparkPipelineResult> {
  const contract = contractIn || normalizeSparkShapeContract(shape);
  const missing = validateSparkShapeContract(contract);
  if (!contract || missing.length) {
    const msg = `Invalid spark shape contract: ${missing.join(', ') || 'unknown'}`;
    return {
      passed: false,
      draftSessionId,
      workspaceRoot: '',
      contract: contract as SparkShapeContract,
      attempts: 0,
      evalPath: null,
      lastAttempt: makeStageAttempt('DESIGN', msg),
      message: msg,
    };
  }

  const layout = ensureSparkWorkspace(draftSessionId);
  writeShapeLock(layout, contract);
  // Code agent cwd is parent of starter/ + solution/
  const codeRoot = layout.root;

  emitLog(onEvent, `Workspace ready: ${layout.root}`, { slug: contract.meta.slug });
  onEvent?.({ type: 'buildDir', buildDir: layout.root } as never);

  let lastAttempt: SparkStageAttempt | null = previousAttempt || null;
  if (lastAttempt) {
    emitLog(
      onEvent,
      `Repair mode — seeded from prior ${lastAttempt.phase}: ${lastAttempt.message}`,
      {
        repairOwner: (lastAttempt.details as { repairOwner?: string } | null)?.repairOwner || null,
        step: (lastAttempt.details as { step?: string } | null)?.step || null,
      },
    );
  }
  let evalPath: string | null = null;

  for (let attempt = 1; attempt <= maxIterations; attempt++) {
    emitLog(
      onEvent,
      lastAttempt
        ? `Iteration ${attempt}/${maxIterations} — retry after ${lastAttempt.phase}: ${lastAttempt.message}`
        : `Iteration ${attempt}/${maxIterations}`,
    );

    const priorFailure: SparkStageAttempt | null = lastAttempt;
    const targets = resolveRepairTargets(priorFailure);
    if (priorFailure) {
      emitLog(
        onEvent,
        `Repair routing: owner=${targets.owner} → Data=${targets.runData ? 'run' : 'skip'}, Code=${targets.runCode ? 'run' : 'skip'}`,
        {
          repairOwner: (priorFailure.details as { repairOwner?: string } | null)?.repairOwner || null,
          step: (priorFailure.details as { step?: string } | null)?.step || null,
          phase: priorFailure.phase,
        },
      );
    }

    try {
      if (targets.owner === 'NONE') {
        emitLog(
          onEvent,
          'Platform/infra failure — skipping Data + Code agents; re-running Eval only (fix cluster/network, then Retry)',
          {
            repairOwner: (priorFailure?.details as { repairOwner?: string } | null)?.repairOwner || 'PLATFORM',
            message: priorFailure?.message?.slice(0, 300),
          },
        );
        if (!dirHasPy(layout.gen) || !dirHasPy(layout.solution)) {
          const fail = makeStageAttempt(
            'EVAL',
            'Platform failure and workspace missing gen/ or solution/ — cannot re-Eval',
            { repairOwner: 'PLATFORM' },
          );
          lastAttempt = fail;
          emitLog(onEvent, fail.message, null, 'error');
          continue;
        }
      } else if (targets.runData) {
        onEvent?.({
          type: 'phase',
          phase: 'DATA',
          attempt,
          total: maxIterations,
        } as never);

        const dataResult = await runSparkDataAgent({
          contract,
          genDir: layout.gen,
          draftSessionId,
          // Only feed failure into the agent that owns the repair
          previousAttempt: priorFailure && targets.owner !== 'CODE' ? priorFailure : null,
          onEvent,
        }) as { summary: string; hasWritten: boolean };

        if (!dataResult.hasWritten) {
          const fail = makeStageAttempt('DATA', 'Data Agent wrote no files', {
            dataSummary: dataResult.summary?.slice(0, 400),
            repairOwner: 'DATA',
          });
          lastAttempt = fail;
          emitLog(onEvent, `Data Agent wrote nothing: ${fail.message}`, null, 'warn');
          continue;
        }
      } else {
        emitLog(onEvent, 'Skipping Data Agent (repairOwner≠DATA; keeping existing gen/)');
        if (!dirHasPy(layout.gen)) {
          const fail = makeStageAttempt('DATA', 'Skipped Data Agent but gen/ has no .py — cannot Eval', {
            repairOwner: 'DATA',
          });
          lastAttempt = fail;
          emitLog(onEvent, fail.message, null, 'error');
          continue;
        }
      }

      if (targets.owner !== 'NONE') {
        if (targets.runCode) {
          onEvent?.({
            type: 'phase',
            phase: 'CODE',
            attempt,
            total: maxIterations,
          } as never);

          const codeResult = await runSparkCodeAgent({
            contract,
            codeRoot,
            draftSessionId,
            previousAttempt: priorFailure && targets.owner !== 'DATA' ? priorFailure : null,
            onEvent,
          }) as { summary: string; hasWritten: boolean };

          if (!codeResult.hasWritten) {
            const fail = makeStageAttempt('CODE', 'Code Agent wrote no files', {
              codeSummary: codeResult.summary?.slice(0, 400),
              repairOwner: 'CODE',
            });
            lastAttempt = fail;
            emitLog(onEvent, `Code Agent wrote nothing: ${fail.message}`, null, 'warn');
            continue;
          }
        } else {
          emitLog(onEvent, 'Skipping Code Agent (repairOwner≠CODE; keeping existing starter/ + solution/)');
          if (!dirHasPy(layout.solution)) {
            const fail = makeStageAttempt('CODE', 'Skipped Code Agent but solution/ has no .py — cannot Eval', {
              repairOwner: 'CODE',
            });
            lastAttempt = fail;
            emitLog(onEvent, fail.message, null, 'error');
            continue;
          }
        }
      }

      try {
        const synced = await syncAuthoringAssetsToMinio({
          layout,
          slug: contract.meta.slug,
          draftSessionId,
        });
        emitLog(
          onEvent,
          `Synced authoring assets → MinIO (gen=${synced.gen.count}, starter=${synced.starter.count}, solution=${synced.solution.count})`,
        );
      } catch (syncErr) {
        emitLog(
          onEvent,
          `MinIO sync warning: ${(syncErr as Error).message}`,
          null,
          'warn',
        );
      }
    } catch (e) {
      const phaseHint = ((e as Error).message || '').toLowerCase().includes('data')
        ? 'DATA'
        : 'CODE';
      const fail = makeStageAttempt(
        phaseHint as 'DATA' | 'CODE',
        (e as Error).message || 'Data/Code agent failed',
        {
          stack: (e as Error).stack?.slice(0, 1500),
          repairOwner: phaseHint,
        },
      );
      lastAttempt = fail;
      emitLog(onEvent, `${phaseHint} agent failed: ${fail.message}`, null, 'error');
      continue;
    }

    onEvent?.({
      type: 'phase',
      phase: 'VALIDATION',
      attempt,
      total: maxIterations,
    } as never);

    const validation = await runSparkValidationAgent({
      contract,
      layout,
      draftSessionId,
      onEvent,
    });

    if (!validation.passed) {
      lastAttempt = makeStageAttempt('VALIDATION', validation.feedback, {
        checks: validation.checks,
      });
      emitLog(onEvent, `Validation failed: ${validation.feedback}`, validation.checks, 'warn');
      continue;
    }

    onEvent?.({
      type: 'phase',
      phase: 'EVAL',
      attempt,
      total: maxIterations,
    } as never);

    const evalResult = await runSparkEvalAgent({
      contract,
      layout,
      draftSessionId,
      onEvent,
    });

    if (!evalResult.passed) {
      lastAttempt = evalResult.attempt
        || makeStageAttempt('EVAL', evalResult.message);
      emitLog(onEvent, `Eval failed: ${evalResult.message}`, lastAttempt?.details, 'warn');
      continue;
    }

    evalPath = evalResult.evalPath;
    emitLog(onEvent, `Pipeline passed — ${evalResult.message}`, { evalPath }, 'ok');
    onEvent?.({
      type: 'done',
      buildSessionId: draftSessionId,
      builtChallenge: {
        id: contract.meta.slug,
        sandboxType: 'spark-platform',
        shape: contract,
        workspaceRoot: layout.root,
        evalPath,
      },
      buildValidation: { passed: true, evalPath },
    } as never);

    return {
      passed: true,
      draftSessionId,
      workspaceRoot: layout.root,
      contract,
      attempts: attempt,
      evalPath,
      lastAttempt: null,
      message: evalResult.message,
    };
  }

  const msg = lastAttempt?.message || `Spark pipeline failed after ${maxIterations} iteration(s)`;
  if (lastAttempt) {
    try {
      const reportPath = writeSparkStageFailure(layout.eval, lastAttempt);
      emitLog(onEvent, `Wrote stage failure for Retry → ${reportPath}`);
    } catch (e) {
      emitLog(onEvent, `Could not write stage failure: ${(e as Error).message}`, null, 'warn');
    }
  }
  onEvent?.({ type: 'error', message: msg } as never);
  return {
    passed: false,
    draftSessionId,
    workspaceRoot: layout.root,
    contract,
    attempts: maxIterations,
    evalPath: null,
    lastAttempt,
    message: msg,
  };
}

module.exports = {
  runSparkAuthoringPipeline,
  MAX_ITERATIONS,
};
