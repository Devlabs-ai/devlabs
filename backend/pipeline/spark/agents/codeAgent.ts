'use strict';

/**
 * Spark Code Agent — Claude Agent SDK.
 *
 * Always emits a pair of trees:
 *   implementation → starter/ (stub) + solution/ (full)
 *   debug          → starter/ (broken) + solution/ (fixed)
 */

import * as fs from 'fs';
import * as path from 'path';

import type { BuildEventHandler } from '../../../types/domain';
import type { SparkShapeContract, SparkStageAttempt } from '../../../types/sparkShape';

const { runCodeAgentHarness } = require('../../helpers/codeAgentHarness');
const { formatPreviousStageForPrompt } = require('../stageAttempt');
const {
  authoringInputPrefix,
  authoringStagePrefix,
} = require('../authoringMinio');

const MAX_TURNS = Number(process.env.SPARK_CODE_MAX_TURNS || 35);

function minioBucket(): string {
  return process.env.MINIO_BUCKET || process.env.S3_BUCKET || 'devlabs-data';
}

function s3a(key: string): string {
  return `s3a://${minioBucket()}/${String(key || '').replace(/^\/+/, '')}`;
}

function hiveLayoutExample(inputPath: string, partitions: string[], businessDate?: string): string {
  const parts = (partitions || []).map((p) => {
    if (p === 'business_date' && businessDate) return `${p}=${businessDate}`;
    return `${p}=<value>`;
  });
  if (!parts.length) return `${inputPath}*.parquet`;
  return `${inputPath}${parts.join('/')}/<files>.parquet`;
}

function buildPathContract(
  contract: SparkShapeContract,
  draftSessionId: string,
) {
  const slug = contract.meta.slug;
  const partitions = Array.isArray(contract.data.partitions) ? contract.data.partitions : [];
  const businessDate = contract.data.businessDate || '';
  const usesBusinessDate = partitions.includes('business_date') || Boolean(businessDate);
  const inputPrefix = authoringInputPrefix(slug, draftSessionId);
  const resultsKey = `${authoringStagePrefix(slug, draftSessionId)}results/solution.json`;
  const publishAs = contract.evalCollection?.publishAs
    || `challenges/${slug}/eval/solution.json`;

  const env: Record<string, string> = {
    INPUT_PATH: s3a(inputPrefix),
    OUTPUT_PATH: s3a(resultsKey),
  };
  // Only include BUSINESS_DATE when this challenge uses it (not universal).
  if (usesBusinessDate) {
    env.BUSINESS_DATE = businessDate;
  }

  return {
    bucket: minioBucket(),
    slug,
    draftSessionId,
    partitions,
    businessDate: usesBusinessDate ? businessDate : undefined,
    env,
    keys: {
      authoringInputPrefix: inputPrefix,
      authoringResultsKey: resultsKey,
      publishInputPrefix: `challenges/${slug}/input/`,
      publishEvalKey: publishAs.replace(/^\/+/, ''),
      publishStarterPrefix: `challenges/${slug}/starter/`,
    },
    hiveLayoutExample: hiveLayoutExample(s3a(inputPrefix), partitions, businessDate || undefined),
  };
}

function buildSystemPrompt(
  contract: SparkShapeContract,
  draftSessionId: string,
): string {
  const kind = contract.kind;
  const wrapper = contract.evalCollection.fromJob.wrapper;
  const paths = buildPathContract(contract, draftSessionId);
  const entry = contract.platform.starterFileName;
  const partitions = paths.partitions as string[];
  const partitionList = partitions.length
    ? partitions.map((p) => `\`${p}\``).join(', ')
    : '(none — flat files under INPUT_PATH)';

  const envRows = [
    ['INPUT_PATH', 'Parquet **root** (partition discovery ON when hive partitions exist)', paths.env.INPUT_PATH],
    ['OUTPUT_PATH', 'Single JSON **object** URI (not a directory)', paths.env.OUTPUT_PATH],
  ];
  if (paths.env.BUSINESS_DATE != null) {
    envRows.push(['BUSINESS_DATE', 'Optional date filter / lit for `business_date` partition', paths.env.BUSINESS_DATE || '(from shape)']);
  }

  const envTable = envRows
    .map(([name, meaning, example]) => `| ${name} | ${meaning} | \`${example}\` |`)
    .join('\n');

  const missingPartitionHint = partitions.length
    ? `- If a groupBy/key column is a hive partition key and missing after read, recover it from env when provided (e.g. \`BUSINESS_DATE\` → \`business_date\`) or from the path; do not assume every lab has \`business_date\`.`
    : '- No hive partitions in this shape — treat INPUT_PATH as a flat/root Parquet location.';

  return `You are the Spark Code Agent for Devlabs authoring (data-engineering PySpark labs).

Kind: ${kind}

## Deliverables (STRICT — nothing else)
Under cwd write ONLY:
  ./starter/${entry}
  ./starter/README.md          (≤60 lines)
  ./starter/requirements.txt   (optional)
  ./solution/${entry}
  ./solution/README.md         (≤60 lines)
  ./solution/requirements.txt  (optional)

FORBIDDEN: extra markdown dumps, compliance docs, troubleshooting guides, manifests.
Do not touch gen/. Do not invent sibling doc trees at cwd root.

For kind=implementation:
  - starter/: stub with TODOs — MUST NOT fully solve
  - solution/: complete working app

For kind=debug:
  - starter/: broken app matching kindSpec
  - solution/: fixed app

## Object / path contract (authoring Eval — use these exact shapes)
Bucket: ${paths.bucket}
Slug: ${paths.slug}
Draft: ${paths.draftSessionId}
Hive partitions for this lab: ${partitionList}

Eval injects these environment variables (do not hardcode URLs — read from env):

| Env | Meaning | Example for this draft |
|-----|---------|------------------------|
${envTable}

Object-store keys (MinIO / S3, no scheme):
- Authoring input prefix: \`${paths.keys.authoringInputPrefix}\`
- Authoring result object: \`${paths.keys.authoringResultsKey}\`
- After Publish (Play): input=\`${paths.keys.publishInputPrefix}\`, eval=\`${paths.keys.publishEvalKey}\`, starter=\`${paths.keys.publishStarterPrefix}\`

Expected layout under INPUT_PATH for **this** shape:
  ${paths.hiveLayoutExample}

## Runtime contract (critical)
- Language: ${contract.platform.language}
- Entrypoint: ${entry}
- Read: \`spark.read.parquet(os.environ["INPUT_PATH"])\` — always the input **root** above
${missingPartitionHint}
- Write **exactly** to \`os.environ["OUTPUT_PATH"]\` with Hadoop FileSystem.
  NEVER \`os.makedirs(OUTPUT_PATH)\` + \`open()\`. OUTPUT_PATH is an s3a **file** URI.
  JSON must serialize dates/Decimals — Spark \`date\`/\`datetime\`/\`Decimal\` are NOT json-serializable by default.
  Use this helper:

\`\`\`python
def write_result_json(spark, rows, output_path: str) -> None:
    import json
    from decimal import Decimal
    from datetime import date, datetime

    def _default(o):
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        if isinstance(o, Decimal):
            return str(o)
        raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")

    # Also coerce row values before dumps when building rows:
    # business_date -> str(...); product_id -> int(...); decimals -> str(...)
    payload = json.dumps({"${wrapper}": rows}, indent=2, default=_default)
    conf = spark._jsc.hadoopConfiguration()
    uri = spark._jvm.java.net.URI(output_path)
    fs = spark._jvm.org.apache.hadoop.fs.FileSystem.get(uri, conf)
    path = spark._jvm.org.apache.hadoop.fs.Path(output_path)
    parent = path.getParent()
    if parent is not None and not fs.exists(parent):
        fs.mkdirs(parent)
    out = fs.create(path, True)
    out.write(bytearray(payload, "utf-8"))
    out.close()
\`\`\`

- Output JSON must be {"${wrapper}":[...]} with columns matching evalCollection.columns exactly
- Honor transform.validationRules, groupBy, aggregations (incl. atol)
- Honor schema types from the shape (ints stay ints — never float64 for id columns)

## Efficiency
- Write the files, do at most one verification Read of each main.py, then STOP.
- Do not repeatedly Glob/Read the same paths.
- No long status essays in the final message.`;
}

function buildUserPrompt(
  contract: SparkShapeContract,
  draftSessionId: string,
  previousAttempt: SparkStageAttempt | null,
): string {
  const retry = formatPreviousStageForPrompt(previousAttempt);
  const paths = buildPathContract(contract, draftSessionId);
  const payload = {
    kind: contract.kind,
    kindSpec: contract.kindSpec,
    transform: contract.transform,
    platform: contract.platform,
    evalCollection: contract.evalCollection,
    dataPartitions: contract.data.partitions,
    businessDate: contract.data.businessDate,
    briefHints: contract.brief.problemStatement.hints,
    pathContract: paths,
  };
  return [
    'Implement starter/ and solution/ for this locked Spark shape contract.',
    'Minimal files only. If repairing, fix the Eval error — do not rewrite docs.',
    'Honor pathContract.env exactly (INPUT_PATH / OUTPUT_PATH / BUSINESS_DATE).',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    'Cwd already has starter/ and solution/ — write into those.',
    retry,
  ].filter(Boolean).join('\n');
}

async function runSparkCodeAgent({
  contract,
  codeRoot,
  draftSessionId,
  previousAttempt = null,
  onEvent,
}: {
  contract: SparkShapeContract;
  /** Parent dir that contains starter/ and solution/ */
  codeRoot: string;
  draftSessionId: string;
  previousAttempt?: SparkStageAttempt | null;
  onEvent?: BuildEventHandler;
}): Promise<{ summary: string; hasWritten: boolean; usage: unknown }> {
  fs.mkdirSync(path.join(codeRoot, 'starter'), { recursive: true });
  fs.mkdirSync(path.join(codeRoot, 'solution'), { recursive: true });

  const mode = previousAttempt ? 'repair' : 'scaffold';
  onEvent?.({
    type: 'log',
    level: 'info',
    tag: 'spark_code',
    message: `Code Agent (${mode}, kind=${contract.kind}) — Claude Agent SDK`,
  } as never);

  const result = await runCodeAgentHarness({
    prompt: buildUserPrompt(contract, draftSessionId, previousAttempt),
    systemPrompt: buildSystemPrompt(contract, draftSessionId),
    buildDir: codeRoot,
    maxTurns: MAX_TURNS,
    onEvent,
    label: 'spark_code',
    agentKey: 'spark_code',
  });

  return {
    summary: result.text,
    hasWritten: result.hasWritten,
    usage: result.usage,
  };
}

module.exports = { runSparkCodeAgent, buildPathContract };
