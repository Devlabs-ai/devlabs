/**
 * Run the Spark solution against Run + Submit inputs and publish those
 * outputs as testcases/<id>/expected/ (the grader's golden).
 *
 * Must use the same spark_conf as Play (sample is partition-sensitive).
 *
 *   cd backend && npx tsx scripts/materializeL1SampleExpected.ts
 */
require('dotenv').config({ override: true });

const { getObjectStore, normalizeKey } = require('../workspace/objectStore');

const BUCKET = process.env.MINIO_BUCKET || 'devlabs-data';
const PLATFORM_API =
  process.env.SPARK_PLATFORM_API_URL || 'http://192.168.1.2:30088';
const PREFIX = 'challenges/l1-sample-qa-slice';
const MAIN = `s3a://${BUCKET}/${PREFIX}/solution/src/main.py`;

const SPARK_CONF: Record<string, string> = {
  'spark.sql.adaptive.enabled': 'false',
  'spark.sql.shuffle.partitions': '8',
  'spark.sql.files.maxPartitionBytes': '134217728',
  'spark.sql.files.minPartitionNum': '1',
};

const CASES = [
  { id: '01-qa-slice', label: 'Run' },
  { id: '02-qa-slice', label: 'Submit' },
] as const;

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
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json?: unknown; text?: string }> {
  const url = `${PLATFORM_API.replace(/\/$/, '')}${path}`;
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

async function runCase(
  store: ReturnType<typeof getObjectStore>,
  spec: (typeof CASES)[number],
  stamp: string,
): Promise<string> {
  const inputPath = s3a(`${PREFIX}/testcases/${spec.id}/input/`);
  const outPrefix = `${PREFIX}/reference/${spec.id}/`;
  const outputPath = s3a(outPrefix);
  const k8sName = `ref-l1smpl-${spec.id.slice(0, 8)}-${stamp}`.replace(/[^a-z0-9-]/g, '').slice(0, 52);

  await store.deletePrefix(outPrefix);
  await store.purgeDeleteMarkers(outPrefix).catch(() => 0);

  const body = {
    name: k8sName,
    user: 'devlabs-ref',
    type: 'Python',
    main_application_file: MAIN,
    python_version: '3',
    executor_instances: 2,
    executor_cores: 1,
    executor_memory: '1g',
    driver_cores: 1,
    driver_memory: '1g',
    deps_py_files: [] as string[],
    spark_conf: SPARK_CONF,
    env: {
      INPUT_PATH: inputPath,
      OUTPUT_PATH: outputPath,
    },
  };

  console.log(`\n==> ${spec.label}  ${spec.id}`);
  console.log(`    job=${k8sName}`);
  console.log(`    INPUT=${inputPath}`);
  console.log(`    OUTPUT=${outputPath}`);

  const submit = await platformFetch('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (submit.status >= 400) {
    const detail =
      (submit.json as { detail?: string } | undefined)?.detail
      || submit.text
      || `Spark Platform error ${submit.status}`;
    throw new Error(`${spec.id} submit failed: ${detail}`);
  }

  const deadline = Date.now() + 12 * 60 * 1000;
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
    throw new Error(
      `${spec.id} job ended status=${status}\n${lastLogs.split('\n').slice(-20).join('\n')}`,
    );
  }

  const expectedPrefix = `${PREFIX}/testcases/${spec.id}/expected/`;
  await store.deletePrefix(expectedPrefix);
  await store.purgeDeleteMarkers(expectedPrefix).catch(() => 0);

  const keys: string[] = await store.listKeys(outPrefix);
  const keep = keys.filter(
    (k: string) =>
      !k.includes('_temporary')
      && !k.includes('.spark-staging')
      && !k.endsWith('.crc'),
  );
  if (!keep.some((k: string) => k.endsWith('.parquet'))) {
    throw new Error(`${spec.id}: Spark succeeded but no parquet under ${outPrefix}`);
  }
  for (const key of keep) {
    const rel = key.slice(outPrefix.length);
    if (!rel || rel.endsWith('/')) continue;
    await store.copyObject(key, `${expectedPrefix}${rel}`);
  }
  console.log(`    copied ${keep.length} object(s) → ${expectedPrefix}`);
  return expectedPrefix;
}

async function main(): Promise<void> {
  const store = getObjectStore();
  const stamp = Date.now().toString(36).slice(-6);
  for (const spec of CASES) {
    await runCase(store, spec, stamp);
  }
  console.log('\nREFERENCE_OK  Spark solution outputs published to testcases/<id>/expected/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
