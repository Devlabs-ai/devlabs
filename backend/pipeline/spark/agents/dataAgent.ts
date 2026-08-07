'use strict';

/**
 * Spark Data Agent — Claude Agent SDK.
 *
 * Writes generation scripts under workspace/gen/ from shape.data.
 * Does NOT populate Parquet; Eval runs the scripts later.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { BuildEventHandler } from '../../../types/domain';
import type { SparkShapeContract, SparkStageAttempt } from '../../../types/sparkShape';

const { runCodeAgentHarness } = require('../../helpers/codeAgentHarness');
const { formatPreviousStageForPrompt } = require('../stageAttempt');
const {
  authoringGenPrefix,
  authoringInputPrefix,
} = require('../authoringMinio');
const { workspacePayloadFields } = require('../../helpers/buildWorkspacePaths');

const MAX_TURNS = Number(process.env.SPARK_DATA_MAX_TURNS || 25);

function minioBucket(): string {
  return process.env.MINIO_BUCKET || process.env.S3_BUCKET || 'devlabs-data';
}

function s3a(key: string): string {
  return `s3a://${minioBucket()}/${String(key || '').replace(/^\/+/, '')}`;
}

function buildDataPathContract(contract: SparkShapeContract, draftSessionId: string) {
  const slug = contract.meta.slug;
  const partitions = Array.isArray(contract.data.partitions) ? contract.data.partitions : [];
  const businessDate = contract.data.businessDate || '';
  const usesBusinessDate = partitions.includes('business_date') || Boolean(businessDate);
  const genPrefix = authoringGenPrefix(slug, draftSessionId);
  const inputPrefix = authoringInputPrefix(slug, draftSessionId);

  const hiveParts = partitions.map((p) => (
    p === 'business_date' && businessDate ? `${p}=${businessDate}` : `${p}=<value>`
  ));
  const hiveLayoutExample = partitions.length
    ? `OUTPUT_PREFIX/${hiveParts.join('/')}/<files>.parquet`
    : 'OUTPUT_PREFIX/<files>.parquet';

  const jobEnv: Record<string, string> = {
    OUTPUT_PREFIX: '(local temp dir set by Job — write Parquet HERE only)',
    OUTPUT_DIR: '(alias of OUTPUT_PREFIX)',
    GEN_S3_PREFIX: genPrefix.replace(/\/$/, ''),
    DATA_S3_PREFIX: inputPrefix.replace(/\/$/, ''),
    NUM_STORES: 'from shape.scale.stores when Job sets it',
    ROWS_PER_STORE: 'from shape.scale when Job sets it',
    MALFORMED_RATE: 'from shape.data.malformed.rate when Job sets it',
  };
  if (usesBusinessDate) {
    jobEnv.BUSINESS_DATE = businessDate || '(from shape when present)';
  }

  return {
    bucket: minioBucket(),
    slug,
    draftSessionId,
    partitions,
    businessDate: usesBusinessDate ? businessDate : undefined,
    keys: {
      genPrefix,
      inputPrefix,
      publishInputPrefix: `challenges/${slug}/input/`,
    },
    urls: {
      genPrefix: s3a(genPrefix),
      inputPrefix: s3a(inputPrefix),
      publishInputPrefix: s3a(`challenges/${slug}/input/`),
    },
    jobEnv,
    hiveLayoutExample,
  };
}

function buildSystemPrompt(
  contract: SparkShapeContract,
  draftSessionId: string,
): string {
  const paths = buildDataPathContract(contract, draftSessionId);
  const partitionList = paths.partitions.length
    ? paths.partitions.map((p: string) => `\`${p}\``).join(', ')
    : '(none)';

  const bizLine = paths.businessDate != null
    ? `- BUSINESS_DATE — e.g. \`${paths.businessDate || 'YYYY-MM-DD'}\` (only because this shape uses business_date)`
    : '- Do **not** assume BUSINESS_DATE exists — only honor partition keys listed in shape.data.partitions';

  return `You are the Spark Data Agent for Devlabs authoring (data-engineering labs).

Write a MINIMAL data-generation script. Eval runs it in a Kubernetes Job
(\`devlabs-data-tools\` image: pandas, pyarrow, numpy available) — not on a laptop.

## Deliverables (STRICT — nothing else)
Your cwd **already is** the gen/ directory (workspaceRoot). Write files HERE:
  - generate.py          (required — path MUST be \`generate.py\` or absolute under cwd)
  - requirements.txt     (optional)
  - README.md            (optional; ≤40 lines)

DO NOT write \`gen/generate.py\` (that creates gen/gen/). DO NOT write under /tmp or /work.
DO NOT create a nested gen/ folder. Edit existing generate.py in place on repair.

FORBIDDEN: extra markdown, compliance docs, manifests, indexes, quick-starts,
validate.py, tests, summaries, "DELIVERY_*", "FIXES_*", "START_HERE", etc.
If such files already exist from a prior run, DELETE them (overwrite with empty then
prefer removing via tools). Keep only the allowed set.

## Object / path contract
Bucket: ${paths.bucket}
Slug: ${paths.slug}
Draft: ${paths.draftSessionId}
Hive partitions for this lab: ${partitionList}

| Role | Key (no scheme) | s3a URL |
|------|-----------------|---------|
| Gen scripts uploaded by backend | \`${paths.keys.genPrefix}\` | \`${paths.urls.genPrefix}\` |
| Job uploads Parquet here (DATA_S3_PREFIX) | \`${paths.keys.inputPrefix}\` | \`${paths.urls.inputPrefix}\` |
| After Publish (Play input) | \`${paths.keys.publishInputPrefix}\` | \`${paths.urls.publishInputPrefix}\` |

Job env your script must honor:
- OUTPUT_PREFIX / OUTPUT_DIR — **local** directory inside the Job; write Parquet only here
${bizLine}
- Optional scale knobs: NUM_STORES, ROWS_PER_STORE, MALFORMED_RATE
- Do **not** write to MinIO yourself — Job runner uploads OUTPUT_PREFIX → DATA_S3_PREFIX (\`${paths.keys.inputPrefix}\`)

Expected layout under OUTPUT_PREFIX for **this** shape:
  ${paths.hiveLayoutExample}

## Schema / types (critical)
- Honor shape.data.schema column types exactly in Parquet.
- Integer fields MUST be int32/int64 — never float64/Double.
- Nullable integer columns (e.g. product_id / store_id when malformed injects null):
  NEVER assign None into a numpy/pandas int32 array (TypeError). Use Python lists, pandas dtype=object then cast, or pyarrow arrays with an explicit null mask / pa.array([...], type=pa.int32()).
- KEEP partition key columns from shape.data.partitions INSIDE the Parquet files as data columns too.

## Behavior
- Do NOT materialize Parquet in this authoring session — only write scripts.
- Prefer NUM_STORES / ROWS_PER_STORE / MALFORMED_RATE env when set; else shape.scale.
- NEVER nest OUTPUT_PREFIX under another root path.
- Inject malformed rows per data.malformed.
- Do NOT implement starter/ or solution/ — Code Agent owns those.

## Efficiency
- Prefer pyarrow/pandas vectorized writes with explicit dtypes.
- After generate.py works, STOP. Do not re-read files to "verify" more than once.
- No long chat summaries; finish when files are written.`;
}

function buildUserPrompt(
  contract: SparkShapeContract,
  draftSessionId: string,
  genDir: string,
  previousAttempt: SparkStageAttempt | null,
): string {
  const retry = formatPreviousStageForPrompt(previousAttempt);
  const paths = buildDataPathContract(contract, draftSessionId);
  return [
    'Write minimal gen scripts for this locked Spark shape contract.',
    'cwd IS gen/ — write generate.py (NOT gen/generate.py). Never /tmp.',
    'Only generate.py (+ optional short README.md / requirements.txt). Delete other gen docs.',
    'Honor pathContract (OUTPUT_PREFIX local → Job uploads to DATA_S3_PREFIX).',
    '',
    '```json',
    JSON.stringify({
      data: contract.data,
      meta: contract.meta,
      pathContract: paths,
      ...workspacePayloadFields(genDir),
    }, null, 2),
    '```',
    retry,
  ].filter(Boolean).join('\n');
}

/** Safety net: if agent still created gen/gen/, promote files up. */
function flattenNestedGenDir(genDir: string): void {
  const nested = path.join(genDir, 'gen');
  if (!fs.existsSync(nested) || !fs.statSync(nested).isDirectory()) return;
  for (const name of fs.readdirSync(nested)) {
    const from = path.join(nested, name);
    const to = path.join(genDir, name);
    if (fs.existsSync(to)) {
      // Prefer newer nested write
      if (fs.statSync(from).mtimeMs >= fs.statSync(to).mtimeMs) {
        fs.renameSync(from, to);
      } else {
        fs.rmSync(from, { recursive: true, force: true });
      }
    } else {
      fs.renameSync(from, to);
    }
  }
  fs.rmSync(nested, { recursive: true, force: true });
}

async function runSparkDataAgent({
  contract,
  genDir,
  draftSessionId,
  previousAttempt = null,
  onEvent,
}: {
  contract: SparkShapeContract;
  genDir: string;
  draftSessionId: string;
  previousAttempt?: SparkStageAttempt | null;
  onEvent?: BuildEventHandler;
}): Promise<{ summary: string; hasWritten: boolean; usage: unknown }> {
  const mode = previousAttempt ? 'repair' : 'scaffold';
  onEvent?.({
    type: 'log',
    level: 'info',
    tag: 'spark_data',
    message: `Data Agent (${mode}) — Claude Agent SDK`,
  } as never);

  const result = await runCodeAgentHarness({
    prompt: buildUserPrompt(contract, draftSessionId, genDir, previousAttempt),
    systemPrompt: buildSystemPrompt(contract, draftSessionId),
    buildDir: genDir,
    maxTurns: MAX_TURNS,
    onEvent,
    label: 'spark_data',
    agentKey: 'spark_data',
  });

  flattenNestedGenDir(genDir);

  return {
    summary: result.text,
    hasWritten: result.hasWritten,
    usage: result.usage,
  };
}

module.exports = { runSparkDataAgent };
