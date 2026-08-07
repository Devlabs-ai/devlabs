'use strict';

/**
 * Spark Validation Agent — contract compliance for Data + Code assets.
 *
 * Static checks first (local workspace — agents write locally, pipeline syncs MinIO);
 * optional LLM review via streamWithEvents.
 * Does not run Spark or populate data (that is Eval / K8s Job).
 */

import * as fs from 'fs';
import * as path from 'path';

import type { BuildEventHandler } from '../../../types/domain';
import type { SparkShapeContract, SparkWorkspaceLayout } from '../../../types/sparkShape';

const { streamWithEvents, assertLlmConfigured } = require('../../helpers/agentRuntime');
const { authoringGenPrefix, authoringStarterPrefix, authoringSolutionPrefix, verifyPrefixHasObjects } = require('../authoringMinio');

export interface SparkValidationResult {
  passed: boolean;
  checks: Array<{ id: string; passed: boolean; detail?: string }>;
  feedback: string;
}

function listRelFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...listRelFiles(full, base));
    else out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out.sort();
}

function staticValidate(
  contract: SparkShapeContract,
  layout: SparkWorkspaceLayout,
): SparkValidationResult['checks'] {
  const checks: SparkValidationResult['checks'] = [];
  const genFiles = listRelFiles(layout.gen);
  const starterFiles = listRelFiles(layout.starter);
  const solutionFiles = listRelFiles(layout.solution);

  checks.push({
    id: 'gen_not_empty',
    passed: genFiles.length > 0,
    detail: genFiles.length ? `${genFiles.length} file(s)` : 'gen/ is empty',
  });
  checks.push({
    id: 'gen_entrypoint',
    passed: genFiles.some((f) => /generate\.(py|sh|js|ts)$/i.test(f) || f === 'README.md'),
    detail: genFiles.slice(0, 8).join(', ') || 'none',
  });
  checks.push({
    id: 'starter_not_empty',
    passed: starterFiles.length > 0,
    detail: starterFiles.length ? `${starterFiles.length} file(s)` : 'starter/ empty',
  });
  checks.push({
    id: 'solution_not_empty',
    passed: solutionFiles.length > 0,
    detail: solutionFiles.length ? `${solutionFiles.length} file(s)` : 'solution/ empty',
  });

  const entry = contract.platform.starterFileName.replace(/^\/+/, '');
  checks.push({
    id: 'solution_entrypoint',
    passed: solutionFiles.includes(entry) || solutionFiles.some((f) => f.endsWith(entry)),
    detail: `expected ${entry}`,
  });
  checks.push({
    id: 'starter_entrypoint',
    passed: starterFiles.includes(entry) || starterFiles.some((f) => f.endsWith(entry)),
    detail: `expected ${entry}`,
  });

  // Heuristic: solution should mention OUTPUT_PATH for eval collection
  const solMain = solutionFiles.find((f) => f.endsWith(entry));
  if (solMain) {
    const body = fs.readFileSync(path.join(layout.solution, solMain), 'utf8');
    checks.push({
      id: 'solution_writes_output',
      passed: body.includes(contract.evalCollection.fromJob.envOutputPath) || body.includes('OUTPUT_PATH'),
      detail: `look for ${contract.evalCollection.fromJob.envOutputPath}`,
    });
  }

  return checks;
}

async function runSparkValidationAgent({
  contract,
  layout,
  draftSessionId,
  onEvent,
  useLlm = true,
}: {
  contract: SparkShapeContract;
  layout: SparkWorkspaceLayout;
  draftSessionId?: string;
  onEvent?: BuildEventHandler;
  useLlm?: boolean;
}): Promise<SparkValidationResult> {
  onEvent?.({
    type: 'log',
    level: 'info',
    tag: 'spark_validation',
    message: 'Validation Agent — checking Data + Code assets vs shape',
  } as never);

  const checks = staticValidate(contract, layout);

  if (draftSessionId) {
    try {
      const slug = contract.meta.slug;
      const genV = await verifyPrefixHasObjects(authoringGenPrefix(slug, draftSessionId), 1);
      checks.push({
        id: 'minio_gen',
        passed: genV.ok,
        detail: genV.ok ? `${genV.count} object(s)` : 'gen/ not synced to MinIO',
      });
      const starterV = await verifyPrefixHasObjects(authoringStarterPrefix(slug, draftSessionId), 1);
      checks.push({
        id: 'minio_starter',
        passed: starterV.ok,
        detail: starterV.ok ? `${starterV.count} object(s)` : 'starter/ not synced to MinIO',
      });
      const solV = await verifyPrefixHasObjects(authoringSolutionPrefix(slug, draftSessionId), 1);
      checks.push({
        id: 'minio_solution',
        passed: solV.ok,
        detail: solV.ok ? `${solV.count} object(s)` : 'solution/ not synced to MinIO',
      });
    } catch (e) {
      checks.push({
        id: 'minio_sync',
        passed: false,
        detail: (e as Error).message,
      });
    }
  }

  let feedback = checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.detail || 'failed'}`).join('; ');

  if (useLlm) {
    try {
      assertLlmConfigured('spark_validation', { label: 'spark validation agent' });
      const genFiles = listRelFiles(layout.gen).slice(0, 20);
      const starterFiles = listRelFiles(layout.starter).slice(0, 20);
      const solutionFiles = listRelFiles(layout.solution).slice(0, 20);
      const text = await streamWithEvents({
        agent: 'spark_validation',
        system: `You validate Spark authoring assets against a shape contract.
Reply with JSON only: { "passed": boolean, "issues": ["..."] }.
Check: gen scripts cover data.schema/partitions/malformed; solution implements transform + evalCollection; starter is stub or broken per kind — never the full solution for implementation.`,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              kind: contract.kind,
              kindSpec: contract.kindSpec,
              data: contract.data,
              transform: contract.transform,
              evalCollection: contract.evalCollection,
              files: { gen: genFiles, starter: starterFiles, solution: solutionFiles },
              staticChecks: checks,
            }),
          },
        ],
        maxTokens: 2048,
        onEvent,
        emitDone: false,
      });
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]) as { passed?: boolean; issues?: string[] };
        if (Array.isArray(parsed.issues) && parsed.issues.length) {
          feedback = [feedback, ...parsed.issues].filter(Boolean).join('; ');
          checks.push({
            id: 'llm_review',
            passed: parsed.passed !== false && parsed.issues.length === 0,
            detail: parsed.issues.slice(0, 5).join(' | '),
          });
        } else {
          checks.push({
            id: 'llm_review',
            passed: parsed.passed !== false,
            detail: 'ok',
          });
        }
      }
    } catch (e) {
      onEvent?.({
        type: 'log',
        level: 'warn',
        tag: 'spark_validation',
        message: `LLM review skipped: ${(e as Error).message}`,
      } as never);
    }
  }

  const passed = checks.every((c) => c.passed);
  return {
    passed,
    checks,
    feedback: passed ? 'Assets match shape contract' : (feedback || 'Validation failed'),
  };
}

module.exports = { runSparkValidationAgent, staticValidate };
