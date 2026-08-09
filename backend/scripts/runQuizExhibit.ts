/**
 * Run a quiz exhibit on Spark Platform and return History Server links.
 * Used by publishQuizToMinio.ts --run-exhibit.
 */

import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';

const { getObjectStore, normalizeKey } = require('../workspace/objectStore');

const BUCKET = process.env.MINIO_BUCKET || process.env.S3_BUCKET || 'devlabs-data';
const PLATFORM_API =
  process.env.SPARK_PLATFORM_API_URL || 'http://192.168.1.9:30088';
/** Prefer env, else canonical Mac Mini LAN IP (platform /api/config can be stale). */
const HISTORY_UI_BASE =
  (process.env.SPARK_HISTORY_UI_URL || 'http://192.168.1.9:30080').replace(/\/$/, '');

type QuizRunSpec = {
  testcasesPrefix?: string;
  cases?: string[];
  inputPath?: string;
};

type QuizMetadata = {
  submissionId?: string;
  appName?: string;
  historyAppId?: string | null;
  historyUrl?: string | null;
  run?: QuizRunSpec;
  capturedAt?: string | null;
  k8sName?: string | null;
};

function s3aKey(key: string): string {
  return `s3a://${BUCKET}/${normalizeKey(key)}`;
}

function s3aToKey(s3aOrKey: string): string {
  const raw = String(s3aOrKey || '').trim();
  if (!raw) return '';
  const m = raw.match(/^s3a:\/\/[^/]+\/(.+)$/);
  return normalizeKey(m ? m[1] : raw.replace(/^\/+/, ''));
}

async function platformFetch(
  apiPath: string,
  init?: RequestInit,
): Promise<{ status: number; json?: unknown; text?: string }> {
  const url = `${PLATFORM_API.replace(/\/$/, '')}${apiPath}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return { status: res.status, json: await res.json() };
  }
  return { status: res.status, text: await res.text() };
}

/** Keep app path from Platform links, but always host on HISTORY_UI_BASE. */
function historyUrlForApp(historyAppId: string, platformJob: Record<string, unknown> | null): string {
  const links = (platformJob?.links && typeof platformJob.links === 'object')
    ? (platformJob.links as Record<string, unknown>)
    : {};
  const fromPlatform = String(links.historyApp || '').trim();
  if (fromPlatform) {
    try {
      const u = new URL(fromPlatform);
      return `${HISTORY_UI_BASE}${u.pathname}${u.search}${u.hash}`.replace(/\/$/, '');
    } catch {
      // fall through
    }
  }
  return `${HISTORY_UI_BASE}/history/${encodeURIComponent(historyAppId)}`;
}

function extractApplicationId(logs: string, platformJob: Record<string, unknown> | null): string | null {
  const fromJob = String(
    platformJob?.applicationId || platformJob?.sparkApplicationId || platformJob?.appId || '',
  ).trim();
  if (fromJob) return fromJob;
  const patterns = [
    /Logging events to file:[^\n]*\/(spark-[a-f0-9]+)(?:\.inprogress)?/i,
    /Application ID[:\s]+(spark-[a-z0-9]+)/i,
    /spark\.app\.id[=:\s]+(spark-[a-z0-9]+)/i,
  ];
  for (const re of patterns) {
    const m = logs.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function mapStatus(status: string | undefined): 'succeeded' | 'failed' | 'running' | 'queued' {
  const s = (status || '').toUpperCase();
  if (s === 'SUCCEEDED' || s === 'COMPLETED') return 'succeeded';
  if (s === 'FAILED' || s === 'SUBMISSION_FAILED') return 'failed';
  if (s === 'RUNNING' || s === 'SUCCEEDING' || s === 'FAILING') return 'running';
  return 'queued';
}

async function stageInputs(
  store: ReturnType<typeof getObjectStore>,
  run: QuizRunSpec,
  destPrefixKey: string,
): Promise<string> {
  const destRoot = normalizeKey(destPrefixKey).replace(/\/?$/, '/');

  if (run.inputPath) {
    return s3aKey(s3aToKey(run.inputPath));
  }

  const prefix = run.testcasesPrefix;
  const cases = run.cases || [];
  if (!prefix || !cases.length) {
    throw new Error(
      'metadata.json run requires testcasesPrefix+cases or inputPath when using --run-exhibit',
    );
  }

  const tcRoot = s3aToKey(prefix).replace(/\/?$/, '/');
  let staged = 0;
  for (const caseId of cases) {
    const srcPrefix = `${tcRoot}${caseId}/input/`;
    const keys = (await store.listKeys(srcPrefix)).filter(
      (k: string) => k.endsWith('.parquet') && !k.includes('_temporary'),
    );
    if (!keys.length) {
      throw new Error(`no input parquet for testcase ${caseId} under ${srcPrefix}`);
    }
    const srcKey = keys.sort()[0];
    const destKey = `${destRoot}${caseId}.parquet`;
    await store.copyObject(srcKey, destKey);
    staged += 1;
    console.log(`STAGE input  ${srcKey} → ${destKey}`);
  }
  await store.putObject(`${destRoot}_SUCCESS`, Buffer.from(''), 'text/plain');
  console.log(`STAGE done   ${staged} file(s) → ${s3aKey(destRoot)}`);
  return s3aKey(destRoot);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type ExhibitRunResult = {
  historyAppId: string;
  historyUrl: string;
  k8sName: string;
  metadata: QuizMetadata;
};

/**
 * Upload exhibit, submit Spark job, poll to completion, write metadata.json.
 * Does not publish the full quiz pack — caller uploads after this returns.
 */
async function runQuizExhibit(quizDir: string, quizId: string): Promise<ExhibitRunResult> {
  const exhibitMain = path.join(quizDir, 'exhibit', 'src', 'main.py');
  if (!fs.existsSync(exhibitMain)) {
    throw new Error(`--run-exhibit requires ${exhibitMain}`);
  }

  const quizJson = JSON.parse(fs.readFileSync(path.join(quizDir, 'quiz.json'), 'utf8')) as {
    platformSpec?: {
      limits?: {
        executors?: number;
        executorCores?: number;
        executorMemory?: string;
      };
    };
  };
  const metaPath = path.join(quizDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error('metadata.json missing — required for --run-exhibit');
  }
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as QuizMetadata;
  if (!metadata.run) {
    throw new Error('metadata.json missing run{} (testcasesPrefix+cases or inputPath)');
  }

  const store = getObjectStore();
  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const runRoot = `quizzes/${quizId}/runs/${runId}`;
  const appKey = `${runRoot}/app/src/main.py`;
  const inputPrefix = `${runRoot}/input/`;
  const outputPrefix = `${runRoot}/output/`;

  const code = fs.readFileSync(exhibitMain);
  await store.putObject(normalizeKey(appKey), code, 'text/x-python; charset=utf-8');
  console.log(`PUT  exhibit  s3a://${BUCKET}/${appKey}`);

  const inputPath = await stageInputs(store, metadata.run, inputPrefix);
  const outputPath = s3aKey(outputPrefix);
  const mainFile = s3aKey(appKey);

  const limits = quizJson.platformSpec?.limits || {};
  const executors = Math.min(4, Math.max(1, limits.executors ?? 2));
  const executorCores = Math.min(2, Math.max(1, limits.executorCores ?? 1));
  const executorMemory = limits.executorMemory || '1g';

  const short = createHash('sha256').update(`${quizId}:${runId}`).digest('hex').slice(0, 8);
  const k8sName = `quiz-${short}`.slice(0, 52);
  const appName = metadata.appName || quizId;

  const platformBody = {
    name: k8sName,
    user: 'quiz-publish',
    type: 'Python',
    main_application_file: mainFile,
    python_version: '3',
    executor_instances: executors,
    executor_cores: executorCores,
    executor_memory: executorMemory,
    driver_cores: 1,
    driver_memory: '1g',
    deps_py_files: [] as string[],
    env: {
      BUSINESS_DATE: new Date().toISOString().slice(0, 10),
      INPUT_PATH: inputPath,
      OUTPUT_PATH: outputPath,
      // SparkOperator may ignore appName in code; keep env for clarity
      QUIZ_APP_NAME: appName,
    },
  };

  console.log(`SUBMIT Spark job ${k8sName}`);
  console.log(`  main=${mainFile}`);
  console.log(`  INPUT_PATH=${inputPath}`);
  console.log(`  OUTPUT_PATH=${outputPath}`);
  console.log(`  executors=${executors}x${executorCores}core ${executorMemory}`);

  const submit = await platformFetch('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(platformBody),
  });
  if (submit.status >= 400) {
    const detail =
      (submit.json as { detail?: string } | undefined)?.detail
      || submit.text
      || `Spark Platform error ${submit.status}`;
    throw new Error(`exhibit submit failed: ${detail}`);
  }

  const deadline = Date.now() + 12 * 60 * 1000;
  let platformJob: Record<string, unknown> | null =
    ((submit.json as { job?: unknown })?.job as Record<string, unknown>) ||
    (submit.json as Record<string, unknown>) ||
    null;
  let logsText = '';
  let status = mapStatus(String(platformJob?.status || ''));

  while (Date.now() < deadline) {
    await sleep(5000);
    const statusRes = await platformFetch(`/api/jobs/${encodeURIComponent(k8sName)}`);
    if (statusRes.status === 200 && statusRes.json) {
      platformJob = statusRes.json as Record<string, unknown>;
      status = mapStatus(String(platformJob.status || ''));
    }
    const logsRes = await platformFetch(
      `/api/jobs/${encodeURIComponent(k8sName)}/logs?tail=200`,
    );
    if (logsRes.text != null && logsRes.status < 500) {
      logsText = logsRes.text;
    }
    const appIdHint = extractApplicationId(logsText, platformJob);
    console.log(
      `POLL  status=${status}${appIdHint ? ` app=${appIdHint}` : ''}`,
    );
    if (status === 'succeeded' || status === 'failed') break;
  }

  if (status !== 'succeeded') {
    const err =
      String(platformJob?.error || '').trim()
      || logsText.split('\n').slice(-12).join('\n')
      || `exhibit job ended status=${status}`;
    throw new Error(`exhibit job did not succeed — refusing to publish.\n${err}`);
  }

  // Event logs can lag a few seconds after SUCCEEDED.
  let historyAppId: string | null = null;
  for (let i = 0; i < 12 && !historyAppId; i += 1) {
    historyAppId = extractApplicationId(logsText, platformJob);
    if (historyAppId) break;
    await sleep(2500);
    const statusRes = await platformFetch(`/api/jobs/${encodeURIComponent(k8sName)}`);
    if (statusRes.status === 200 && statusRes.json) {
      platformJob = statusRes.json as Record<string, unknown>;
    }
    const logsRes = await platformFetch(
      `/api/jobs/${encodeURIComponent(k8sName)}/logs?tail=200`,
    );
    if (logsRes.text) logsText = logsRes.text;
  }

  if (!historyAppId) {
    throw new Error(
      'exhibit succeeded but applicationId was not found in Platform job/logs — refusing to publish',
    );
  }

  const historyUrl = historyUrlForApp(historyAppId, platformJob);

  const next: QuizMetadata = {
    ...metadata,
    historyAppId,
    historyUrl,
    capturedAt: new Date().toISOString(),
    k8sName,
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`WRITE metadata.json  historyAppId=${historyAppId}`);
  console.log(`WRITE metadata.json  historyUrl=${historyUrl}`);

  return { historyAppId, historyUrl, k8sName, metadata: next };
}

module.exports = { runQuizExhibit };
