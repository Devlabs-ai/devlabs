/**
 * Publish Helix lab 9 (l1-enrich-auth-mcc) to MinIO: meta, starter, solution,
 * then generate Card Rails copies + planted unpublished MCCs + expected Parquet.
 *
 *   cd backend && npx tsx scripts/publishL1EnrichAuthMcc.ts
 */
require('dotenv').config({ override: true });

import fs from 'fs';
import path from 'path';

const { getObjectStore, normalizeKey } = require('../workspace/objectStore');
const { writeChallengeMeta } = require('../challenges/minioChallengeAssets');

const BUCKET = process.env.MINIO_BUCKET || 'devlabs-data';
const PLATFORM_API =
  process.env.SPARK_PLATFORM_API_URL || 'http://192.168.1.2:30088';
const PREFIX = 'challenges/l1-enrich-auth-mcc';
const PACK_FILE = path.join(__dirname, '../challenges/packs/l1-enrich-auth-mcc.json');
const GEN_FILE = path.join(__dirname, 'genL1EnrichAuthMcc.py');

const STARTER = `"""Overnight auth MCC names — Spark entrypoint."""

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
import os

INPUT_PATH = os.environ["INPUT_PATH"]
DIM_PATH = os.environ["DIM_PATH"]
OUTPUT_PATH = os.environ["OUTPUT_PATH"]


def main() -> None:
    spark = SparkSession.builder.appName("enrich-auth-mcc").getOrCreate()

    df = spark.read.parquet(INPUT_PATH)
    mcc = spark.read.parquet(DIM_PATH)

    # TODO: keep approved auths, put published MCC names on them,
    # keep unpublished codes with null names, write Parquet.
    _ = F

    spark.stop()


if __name__ == "__main__":
    main()
`;

const SOLUTION = `"""Overnight auth MCC names — Spark entrypoint."""

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
import os

INPUT_PATH = os.environ["INPUT_PATH"]
DIM_PATH = os.environ["DIM_PATH"]
OUTPUT_PATH = os.environ["OUTPUT_PATH"]


def main() -> None:
    spark = SparkSession.builder.appName("enrich-auth-mcc").getOrCreate()

    auths = spark.read.parquet(INPUT_PATH).filter(F.col("response_code") == "00")
    mcc = spark.read.parquet(DIM_PATH).select("mcc", "mcc_description", "category")
    out = auths.join(mcc, on="mcc", how="left")
    out.write.mode("overwrite").parquet(OUTPUT_PATH)

    spark.stop()


if __name__ == "__main__":
    main()
`;

function s3a(key: string): string {
  return `s3a://${BUCKET}/${normalizeKey(key)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mapStatus(status: string | undefined): string {
  const s = (status || '').toUpperCase();
  if (s === 'SUCCEEDED' || s === 'COMPLETED') return 'succeeded';
  if (s === 'FAILED' || s === 'SUBMISSION_FAILED') return 'failed';
  if (s === 'RUNNING' || s === 'SUCCEEDING' || s === 'FAILING') return 'running';
  if (s === 'SUBMITTED') return 'submitted';
  return 'queued';
}

async function platformFetch(
  pathName: string,
  init?: RequestInit,
): Promise<{ status: number; json?: unknown; text?: string }> {
  const url = `${PLATFORM_API.replace(/\/$/, '')}${pathName}`;
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return { status: res.status, json: await res.json() };
  }
  return { status: res.status, text: await res.text() };
}

async function runGenerate(
  store: ReturnType<typeof getObjectStore>,
): Promise<void> {
  const stamp = Date.now().toString(36).slice(-6);
  const k8sName = `gen-l1eam-${stamp}`.replace(/[^a-z0-9-]/g, '').slice(0, 52);
  const mainFile = s3a(`${PREFIX}/generate/generate.py`);

  const body = {
    name: k8sName,
    user: 'devlabs-ref',
    type: 'Python',
    main_application_file: mainFile,
    python_version: '3',
    executor_instances: 2,
    executor_cores: 1,
    executor_memory: '2g',
    driver_cores: 1,
    driver_memory: '2g',
    deps_py_files: [] as string[],
    spark_conf: {
      'spark.sql.adaptive.enabled': 'false',
      'spark.sql.shuffle.partitions': '8',
    },
    env: {},
  };

  console.log(`==> generate  job=${k8sName}`);
  const submit = await platformFetch('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (submit.status >= 400) {
    const detail =
      (submit.json as { detail?: string } | undefined)?.detail
      || submit.text
      || `Spark Platform error ${submit.status}`;
    throw new Error(`generate submit failed: ${detail}`);
  }

  const deadline = Date.now() + 20 * 60 * 1000;
  let status = 'queued';
  let lastLogs = '';
  while (Date.now() < deadline) {
    await sleep(5000);
    const statusRes = await platformFetch(`/api/jobs/${encodeURIComponent(k8sName)}`);
    if (statusRes.status === 200 && statusRes.json) {
      status = mapStatus(String((statusRes.json as { status?: string }).status || ''));
    }
    const logsRes = await platformFetch(
      `/api/jobs/${encodeURIComponent(k8sName)}/logs?tail=40`,
    );
    if (logsRes.text) lastLogs = logsRes.text;
    console.log(`    poll status=${status}`);
    if (status === 'succeeded' || status === 'failed') break;
  }

  if (status !== 'succeeded') {
    throw new Error(`generate ended status=${status}\n${lastLogs.split('\n').slice(-30).join('\n')}`);
  }

  for (const p of [
    `${PREFIX}/dims/mcc`,
    `${PREFIX}/testcases/01-auth-mcc/input`,
    `${PREFIX}/testcases/01-auth-mcc/expected`,
    `${PREFIX}/testcases/02-auth-mcc/input`,
    `${PREFIX}/testcases/02-auth-mcc/expected`,
  ]) {
    const keys: string[] = await store.listKeys(p);
    const parquet = keys.filter((k: string) => k.endsWith('.parquet') && !k.includes('_temporary'));
    console.log(`    ${p}: ${parquet.length} parquet object(s)`);
    if (!parquet.length) throw new Error(`no parquet under ${p}`);
  }
}

async function main(): Promise<void> {
  const store = getObjectStore();
  const pack = JSON.parse(fs.readFileSync(PACK_FILE, 'utf8'));
  const generatePy = fs.readFileSync(GEN_FILE, 'utf8');

  console.log('==> drop previous challenge copies');
  for (const p of [`${PREFIX}/testcases`, `${PREFIX}/dims`, `${PREFIX}/reference`]) {
    const n = await store.deletePrefix(p);
    await store.purgeDeleteMarkers(p).catch(() => 0);
    console.log(`    deleted ${n} objects under ${p}`);
  }

  console.log('==> challenge.json / starter / solution / generate.py');
  await writeChallengeMeta(pack);
  await store.putObject(`${PREFIX}/starter/src/main.py`, STARTER, 'text/x-python; charset=utf-8');
  await store.putObject(`${PREFIX}/solution/src/main.py`, SOLUTION, 'text/x-python; charset=utf-8');
  await store.putObject(`${PREFIX}/generate/generate.py`, generatePy, 'text/x-python; charset=utf-8');

  await runGenerate(store);
  console.log('\nPUBLISH_OK  l1-enrich-auth-mcc meta + Card Rails copies + expected/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
