'use strict';

/**
 * Snapshot workspace → immutable job prefix, submit via Spark Platform API.
 */

import { createHash } from 'crypto';

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { getObjectStore, normalizeKey } = require('./objectStore');
const workspaceStore = require('./workspaceStore');
const { gradeOutputAgainstSolution } = require('./sparkGrade');
const {
  parseScoringSpec,
  attachExecutionScore,
  scoreNeedsBackfill,
} = require('./sparkScore');

const BUCKET = process.env.MINIO_BUCKET || process.env.S3_BUCKET || 'devlabs-data';
const PLATFORM_API =
  process.env.SPARK_PLATFORM_API_URL || 'http://192.168.1.9:30088';
const HISTORY_UI_FALLBACK =
  (process.env.SPARK_HISTORY_UI_URL || '').replace(/\/$/, '') || null;

/** Lazily filled from SPARK_HISTORY_UI_URL or Platform /api/config. */
let historyBaseCache: string | null = HISTORY_UI_FALLBACK;

export type SparkJobMode = 'run' | 'submit';

export interface SparkJobLimits {
  /** Driver cores (platform `driver_cores`). */
  driver?: number;
  /** Driver memory string, e.g. "1g" (platform `driver_memory`). */
  driverMemory?: string;
  executors?: number;
  executorCores?: number;
  executorMemory?: string;
  /** Playground trail / lab knobs: Adaptive Query Execution. */
  aqe?: boolean;
  /** spark.sql.shuffle.partitions */
  shufflePartitions?: number;
  /** spark.sql.adaptive.skewJoin.enabled */
  skewJoin?: boolean;
  /** spark.sql.autoBroadcastJoinThreshold (e.g. "-1", "10m"). */
  autoBroadcastJoinThreshold?: string;
  /** Wall-clock seconds from SparkApplication creation; platform watcher kills the job. */
  hardTimeoutSeconds?: number;
}

export interface SparkKnobDef {
  id?: string;
  conf?: string;
  default?: string;
  options?: Array<{ value?: string; label?: string }>;
}

export interface StartSparkJobOpts {
  session: {
    id: string;
    challengeId: string | null;
    userId?: string | null;
    workspacePrefix?: string | null;
    entrypoint?: string | null;
  };
  mode: SparkJobMode;
  /**
   * Direct INPUT_PATH (legacy / non-testcase challenges).
   * Ignored when testcasesPrefix + cases are provided (platform stages inputs).
   */
  inputPath?: string;
  businessDate: string;
  /** Author expected JSON, or testcases/ prefix for Parquet row-diff. */
  evalSolutionPath?: string;
  /** Canonical testcases/ prefix (s3a). */
  testcasesPrefix?: string;
  /** Case ids to run for this job (from runCases / submitCases). */
  cases?: string[];
  /** Row-diff keys for Parquet grading. */
  gradeKeys?: string[];
  /** json (default) → results/<id>/solution.json; parquet/csv → results/<id>/ */
  outputFormat?: 'json' | 'parquet' | 'csv';
  /** Optional products dimension path → env PRODUCTS_PATH. */
  productsPath?: string;
  /** Fact path → env TXN_INPUT_PATH. */
  txnInputPath?: string;
  /** Rate-card path → env RATE_INPUT_PATH. */
  rateInputPath?: string;
  /** Events path → env INPUT_A_PATH. */
  eventsInputPath?: string;
  /** Catalog path → env INPUT_B_PATH. */
  catalogInputPath?: string;
  /** Per-challenge grader (s3a path to a Python script). */
  gradeScript?: string;
  /**
   * When true with testcasesPrefix+cases: stage input/ → INPUT_A_PATH and
   * input_b/ → INPUT_B_PATH (merge / dual-drop labs).
   */
  dualInput?: boolean;
  limits?: SparkJobLimits;
  /**
   * Learner knob overlay (conf key or knob id → value).
   * Scored labs only apply keys declared on the challenge's platformSpec.knobs.
   */
  sparkKnobs?: Record<string, string>;
  /** Override session entrypoint for this job (workspace-relative .py). */
  entrypoint?: string;
}

/**
 * Copy testcases/<id>/<folder>/*.parquet → destPrefix/<id>.parquet for one Spark read.
 */
async function stageTestcaseInputs(
  store: ReturnType<typeof getObjectStore>,
  testcasesPrefixS3a: string,
  caseIds: string[],
  destPrefixKey: string,
  folder: string = 'input',
): Promise<{ inputPathS3a: string; stagedFiles: number }> {
  const tcRoot = s3aToKeyLocal(testcasesPrefixS3a).replace(/\/?$/, '/');
  const destRoot = normalizeKey(destPrefixKey).replace(/\/?$/, '/');
  const folderName = (folder || 'input').replace(/^\/+|\/+$/g, '') || 'input';
  let stagedFiles = 0;

  for (const caseId of caseIds) {
    const srcPrefix = `${tcRoot}${caseId}/${folderName}/`;
    const keys = (await store.listKeys(srcPrefix)).filter(
      (k: string) => k.endsWith('.parquet') && !k.includes('_temporary'),
    );
    if (!keys.length) {
      throw Object.assign(
        new Error(`no input parquet for testcase ${caseId} under ${srcPrefix}`),
        { status: 400 },
      );
    }
    // One file per case keeps spark.read.parquet(dir) simple.
    const srcKey = keys.sort()[0];
    const destKey = `${destRoot}${caseId}.parquet`;
    await store.copyObject(srcKey, destKey);
    stagedFiles += 1;
  }

  await store.putObject(`${destRoot}_SUCCESS`, Buffer.from(''), 'text/plain');
  return { inputPathS3a: s3aKey(destRoot), stagedFiles };
}

function s3aToKeyLocal(s3aOrKey: string): string {
  const raw = String(s3aOrKey || '').trim();
  if (!raw) return '';
  const m = raw.match(/^s3a:\/\/[^/]+\/(.+)$/);
  return normalizeKey(m ? m[1] : raw.replace(/^\/+/, ''));
}

function workspaceRootFromPrefix(workspacePrefix: string): string {
  const p = normalizeKey(workspacePrefix).replace(/\/?$/, '');
  if (p.endsWith('/project')) return p.slice(0, -'/project'.length);
  return p;
}

function s3aKey(key: string): string {
  return `s3a://${BUCKET}/${normalizeKey(key)}`;
}

function dnsJobName(userId: string, jobId: string, mode: SparkJobMode): string {
  const user = (userId || 'anon').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'anon';
  const short = jobId.replace(/-/g, '').slice(0, 8);
  const prefix = mode === 'run' ? 'run' : 'sub';
  // max 52
  return `${prefix}-dps-${user}-${short}`.slice(0, 52);
}

type LabPlatformSpec = {
  limits?: SparkJobLimits;
  sparkConf?: Record<string, unknown>;
  knobs?: SparkKnobDef[];
  scoring?: unknown;
  txnInputPath?: string;
  rateInputPath?: string;
  runTxnInputPath?: string;
  runRateInputPath?: string;
  eventsInputPath?: string;
  catalogInputPath?: string;
  runEventsInputPath?: string;
  runCatalogInputPath?: string;
};

function safeWorkspacePy(raw: unknown, fallback: string): string {
  const fallbackSafe = String(fallback || 'src/main.py').replace(/^\/+/, '') || 'src/main.py';
  const t = String(raw || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\\/g, '/');
  if (!t || t.includes('..') || t.endsWith('/') || t.length > 240) return fallbackSafe;
  if (!t.toLowerCase().endsWith('.py')) return fallbackSafe;
  return t;
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

function resolveHardTimeoutSeconds(
  playgroundTrail: boolean,
  limits?: SparkJobLimits | null,
): number {
  const fallback = playgroundTrail ? 900 : 600;
  return clampInt(limits?.hardTimeoutSeconds, 30, 7200, fallback);
}

function parseSparkConfMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || !k.startsWith('spark.') || k.length > 128) continue;
    // K8s Spark Operator — yarn.* makes spark-submit take a Hadoop file-dist path.
    if (k.startsWith('spark.yarn.')) continue;
    if (v == null) continue;
    const s = String(v).trim();
    if (!s || s.length > 64) continue;
    out[k] = s;
  }
  return out;
}

function applyDeclaredKnobs(
  client: Record<string, string> | undefined,
  knobs: SparkKnobDef[] | undefined,
): Record<string, string> {
  if (!client || !knobs?.length) return {};
  const byConf = new Map<string, SparkKnobDef>();
  const byId = new Map<string, SparkKnobDef>();
  for (const def of knobs) {
    if (def?.conf) byConf.set(String(def.conf), def);
    if (def?.id) byId.set(String(def.id), def);
  }
  const out: Record<string, string> = {};
  for (const [key, rawVal] of Object.entries(client)) {
    const def = byConf.get(key) || byId.get(key);
    if (!def?.conf) continue;
    const allowed = (def.options || [])
      .map((o) => (o?.value != null ? String(o.value) : ''))
      .filter(Boolean);
    const v = String(rawVal);
    if (allowed.length && !allowed.includes(v)) continue;
    out[def.conf] = v;
  }
  return out;
}

async function loadLabPlatformSpec(challengeId: string | null | undefined): Promise<LabPlatformSpec | null> {
  if (!challengeId || challengeId === 'spark-playground') return null;
  try {
    const { loadChallengeMeta } = require('../challenges/minioChallengeAssets');
    const meta = await loadChallengeMeta(challengeId);
    if (meta?.platformSpec && typeof meta.platformSpec === 'object') {
      return meta.platformSpec as LabPlatformSpec;
    }
  } catch {
    /* fall through to catalog */
  }
  try {
    const loader = require('../challenges/loader');
    const c = loader.getChallenge(challengeId);
    if (c?.sparkPlatform && typeof c.sparkPlatform === 'object') {
      return c.sparkPlatform as LabPlatformSpec;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function scoreGradeForJob(
  jobId: string,
  grade: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const row = await getJobRow(jobId);
  if (!row) return grade;
  const spec = await loadLabPlatformSpec(String(row.challenge_id || ''));
  const scoring = parseScoringSpec(spec?.scoring);
  if (!scoring?.executionTime) return grade;
  const metrics = parseRunMetrics(row.run_metrics);
  const executionMs = metrics?.sparkJobsDurationMs ?? null;
  return attachExecutionScore(grade, scoring.executionTime, executionMs);
}

async function maybeRescoreExecution(jobId: string): Promise<void> {
  const row = await getJobRow(jobId);
  if (!row) return;
  const spec = await loadLabPlatformSpec(String(row.challenge_id || ''));
  const scoring = parseScoringSpec(spec?.scoring);
  if (!scoring?.executionTime) return;
  const metrics = parseRunMetrics(row.run_metrics);
  const executionMs = metrics?.sparkJobsDurationMs ?? null;
  let grade: Record<string, unknown> | null = null;
  if (row.grade_result && typeof row.grade_result === 'object') {
    grade = row.grade_result as Record<string, unknown>;
  } else if (typeof row.grade_result === 'string') {
    try { grade = JSON.parse(row.grade_result) as Record<string, unknown>; } catch { grade = null; }
  }
  if (!grade || !scoreNeedsBackfill(grade, executionMs, scoring.executionTime)) return;
  const next = attachExecutionScore(
    grade,
    scoring.executionTime,
    executionMs != null && executionMs > 0 ? executionMs : (grade.score as { executionMs?: number } | undefined)?.executionMs ?? null,
  );
  await pool.query(
    `UPDATE submissions SET grade_result=$2, updated_at=$3 WHERE id=$1`,
    [jobId, JSON.stringify(next), Date.now()],
  );
}

async function snapshotProject(
  projectPrefix: string,
  jobAppPrefix: string,
): Promise<{ files: number; pyRelPaths: string[] }> {
  const store = getObjectStore();
  const srcRoot = normalizeKey(projectPrefix).replace(/\/?$/, '/');
  const destRoot = normalizeKey(jobAppPrefix).replace(/\/?$/, '/');
  const keys = await store.listKeys(srcRoot);
  let files = 0;
  const pyRelPaths: string[] = [];
  for (const key of keys) {
    if (!key.startsWith(srcRoot)) continue;
    const rel = key.slice(srcRoot.length);
    if (!rel || rel.endsWith('/')) continue;
    await store.copyObject(key, `${destRoot}${rel}`);
    files += 1;
    if (rel.endsWith('.py')) pyRelPaths.push(rel);
  }
  return { files, pyRelPaths };
}

async function writeManifest(
  key: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  const store = getObjectStore();
  await store.putObject(key, JSON.stringify(manifest, null, 2), 'application/json');
}

async function platformFetch(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json?: unknown; text?: string }> {
  const url = `${PLATFORM_API.replace(/\/$/, '')}${path}`;
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

function mapPlatformStatus(status: string | undefined): string {
  const s = (status || '').toUpperCase();
  if (s === 'SUCCEEDED' || s === 'COMPLETED') return 'succeeded';
  if (s === 'FAILED' || s === 'SUBMISSION_FAILED') return 'failed';
  if (s === 'RUNNING' || s === 'SUCCEEDING' || s === 'FAILING') return 'running';
  if (s === 'SUBMITTED') return 'submitted';
  if (s === 'PENDING' || s === 'UNKNOWN' || !s) return 'queued';
  return 'queued';
}

function parsePlatformJob(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return null;
}

function parseJobLogs(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Prefer Spark operator id; fall back to event-log path in driver logs. */
function extractApplicationIdFromLogs(logs: string[]): string | null {
  const text = logs.join('\n');
  const patterns = [
    /Logging events to file:[^\n]*\/(spark-[a-f0-9]+)(?:\.inprogress)?/i,
    /Application ID[:\s]+(spark-[a-z0-9]+)/i,
    /spark\.app\.id[=:\s]+(spark-[a-z0-9]+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function mergeApplicationIdIntoPlatformJob(
  platformJob: Record<string, unknown> | null,
  applicationId: string | null,
): Record<string, unknown> | null {
  if (!platformJob || !applicationId) return platformJob;
  if (platformJob.applicationId === applicationId) return platformJob;
  const links = (platformJob.links && typeof platformJob.links === 'object')
    ? { ...(platformJob.links as Record<string, unknown>) }
    : {};
  const historyBase = String(
    links.history || historyBaseCache || HISTORY_UI_FALLBACK || '',
  ).replace(/\/$/, '');
  if (historyBase) {
    links.history = historyBase;
    links.historyApp = `${historyBase}/history/${applicationId}`;
  }
  return {
    ...platformJob,
    applicationId,
    links,
  };
}

/** Spark application id + History Server URL for debugging. */
function sparkDebugLinks(
  platformJob: unknown,
  logs: string[] = [],
): {
  applicationId: string | null;
  historyUrl: string | null;
  historyServerUrl: string | null;
} {
  const pj = parsePlatformJob(platformJob);
  const links = (pj?.links && typeof pj.links === 'object')
    ? (pj.links as Record<string, unknown>)
    : {};
  // Cache history base from any job payload we see.
  const fromLinks = String(links.history || '').replace(/\/$/, '');
  if (fromLinks && !historyBaseCache) historyBaseCache = fromLinks;

  const applicationId = String(
    pj?.applicationId || pj?.sparkApplicationId || pj?.appId || '',
  ).trim()
    || extractApplicationIdFromLogs(logs)
    || null;
  const historyServerUrl = String(
    links.history || historyBaseCache || HISTORY_UI_FALLBACK || '',
  ).replace(/\/$/, '') || null;
  const historyApp = String(links.historyApp || '').trim()
    || (applicationId && historyServerUrl
      ? `${historyServerUrl}/history/${encodeURIComponent(applicationId)}`
      : '');
  const historyUrl = historyApp || historyServerUrl;
  return { applicationId, historyUrl, historyServerUrl };
}

async function resolveHistoryBase(): Promise<string | null> {
  if (historyBaseCache) return historyBaseCache;
  try {
    const res = await platformFetch('/api/config');
    const url = String(
      (res.json as { historyUiUrl?: string } | undefined)?.historyUiUrl || '',
    ).replace(/\/$/, '');
    if (url) historyBaseCache = url;
  } catch {
    // ignore — leave null until env or job payload provides it
  }
  return historyBaseCache;
}

export interface SparkRunMetrics {
  /** First Spark job submit → last job complete (excludes image pull / pod setup). */
  sparkJobsDurationMs: number | null;
  /** History Server application attempt duration (includes SparkContext / executor register). */
  sparkAppDurationMs: number | null;
  sparkJobCount: number;
  fetchedAt: number;
}

function parseRunMetrics(raw: unknown): SparkRunMetrics | null {
  if (!raw) return null;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  const m = obj as Record<string, unknown>;
  return {
    sparkJobsDurationMs:
      typeof m.sparkJobsDurationMs === 'number' ? m.sparkJobsDurationMs : null,
    sparkAppDurationMs:
      typeof m.sparkAppDurationMs === 'number' ? m.sparkAppDurationMs : null,
    sparkJobCount: typeof m.sparkJobCount === 'number' ? m.sparkJobCount : 0,
    fetchedAt: typeof m.fetchedAt === 'number' ? m.fetchedAt : 0,
  };
}

function parseHistoryTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const asNum = Number(v);
    if (Number.isFinite(asNum) && asNum > 1e11) return asNum;
    // History Server often emits "...GMT" which Date.parse rejects — normalize to Z.
    const normalized = v.trim().replace(/GMT$/i, 'Z');
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function historyFetchJson(url: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull execution timing from Spark History Server.
 * Prefer jobs wall (first submit → last complete) over full app attempt duration —
 * that better excludes driver/executor image pull and K8s scheduling.
 */
async function fetchHistoryExecutionMetrics(
  applicationId: string,
): Promise<SparkRunMetrics | null> {
  const base = await resolveHistoryBase();
  if (!base || !applicationId) return null;
  const appEnc = encodeURIComponent(applicationId);

  let sparkAppDurationMs: number | null = null;
  const appJson = await historyFetchJson(`${base}/api/v1/applications/${appEnc}`);
  if (appJson && typeof appJson === 'object') {
    const attempts = (appJson as { attempts?: Array<Record<string, unknown>> }).attempts;
    const last = Array.isArray(attempts) && attempts.length
      ? attempts[attempts.length - 1]
      : null;
    if (last) {
      // Prefer epoch fields — string times are fine too; ignore duration <= 0 (incomplete).
      const start =
        (typeof last.startTimeEpoch === 'number' ? last.startTimeEpoch : null)
        ?? parseHistoryTime(last.startTime);
      const end =
        (typeof last.endTimeEpoch === 'number' ? last.endTimeEpoch : null)
        ?? parseHistoryTime(last.endTime);
      if (start != null && end != null && end > start) {
        sparkAppDurationMs = end - start;
      } else if (
        typeof last.duration === 'number'
        && Number.isFinite(last.duration)
        && last.duration > 0
      ) {
        sparkAppDurationMs = last.duration;
      }
    }
  }

  // Prefer /jobs (this History build rejects /{attempt}/jobs).
  let jobs: Array<Record<string, unknown>> = [];
  const jobUrls = [
    `${base}/api/v1/applications/${appEnc}/jobs`,
    `${base}/api/v1/applications/${appEnc}/1/jobs`,
    `${base}/api/v1/applications/${appEnc}/0/jobs`,
  ];
  for (const url of jobUrls) {
    const jobsJson = await historyFetchJson(url);
    if (Array.isArray(jobsJson) && jobsJson.length) {
      jobs = jobsJson as Array<Record<string, unknown>>;
      break;
    }
  }

  let sparkJobsDurationMs: number | null = null;
  const starts: number[] = [];
  const ends: number[] = [];
  for (const j of jobs) {
    const s = parseHistoryTime(j.submissionTime);
    const e = parseHistoryTime(j.completionTime);
    if (s != null) starts.push(s);
    if (e != null) ends.push(e);
  }
  if (starts.length && ends.length) {
    sparkJobsDurationMs = Math.max(...ends) - Math.min(...starts);
    if (sparkJobsDurationMs < 0) sparkJobsDurationMs = null;
  }

  if (sparkJobsDurationMs == null && sparkAppDurationMs == null) return null;
  return {
    sparkJobsDurationMs,
    sparkAppDurationMs,
    sparkJobCount: jobs.length,
    fetchedAt: Date.now(),
  };
}

async function ensureRunMetrics(jobId: string): Promise<SparkRunMetrics | null> {
  const row = await getJobRow(jobId);
  if (!row) return null;
  const existing = parseRunMetrics(row.run_metrics);
  const hasExec = existing?.sparkJobsDurationMs != null && existing.sparkJobsDurationMs > 0;
  const hasApp = existing?.sparkAppDurationMs != null && existing.sparkAppDurationMs > 0;
  // Retry when either metric is missing/zero — History can report duration 0 before
  // the attempt is fully closed even though jobs already completed.
  if (hasExec && hasApp) {
    return existing;
  }
  const status = String(row.status || '');
  if (status !== 'succeeded' && status !== 'failed') return existing;
  const debug = sparkDebugLinks(parsePlatformJob(row.platform_job), parseJobLogs(row.logs));
  if (!debug.applicationId) return existing;
  const metrics = await fetchHistoryExecutionMetrics(debug.applicationId);
  if (!metrics) return existing;
  const merged: SparkRunMetrics = {
    sparkJobsDurationMs:
      (metrics.sparkJobsDurationMs != null && metrics.sparkJobsDurationMs > 0
        ? metrics.sparkJobsDurationMs
        : existing?.sparkJobsDurationMs)
      ?? null,
    sparkAppDurationMs:
      (metrics.sparkAppDurationMs != null && metrics.sparkAppDurationMs > 0
        ? metrics.sparkAppDurationMs
        : existing?.sparkAppDurationMs)
      ?? null,
    sparkJobCount: metrics.sparkJobCount || existing?.sparkJobCount || 0,
    fetchedAt: Date.now(),
  };
  await pool.query(
    `UPDATE submissions SET run_metrics=$2, updated_at=$3 WHERE id=$1`,
    [jobId, JSON.stringify(merged), Date.now()],
  ).catch(() => {});
  return merged;
}

/** Pull applicationId / history links from Platform + driver logs. */
async function enrichJobDebug(jobId: string): Promise<Record<string, unknown>> {
  await resolveHistoryBase();
  const row = await getJobRow(jobId);
  if (!row) return {};
  const logs = parseJobLogs(row.logs);
  let platformJob = parsePlatformJob(row.platform_job);
  const k8sName = String(row.k8s_name || '');
  if (k8sName) {
    try {
      const statusRes = await platformFetch(`/api/jobs/${encodeURIComponent(k8sName)}`);
      if (statusRes.status === 200 && statusRes.json) {
        platformJob = parsePlatformJob(statusRes.json);
      }
    } catch {
      // keep last-known row
    }
  }
  const debug = sparkDebugLinks(platformJob, logs);
  platformJob = mergeApplicationIdIntoPlatformJob(platformJob, debug.applicationId);
  if (platformJob) {
    await pool.query(
      `UPDATE submissions SET platform_job=$2, updated_at=$3 WHERE id=$1`,
      [jobId, JSON.stringify(platformJob), Date.now()],
    ).catch(() => {});
  }
  return publicJob(await getJobRow(jobId));
}

async function startSparkJob(opts: StartSparkJobOpts): Promise<Record<string, unknown>> {
  await resolveHistoryBase();
  const { session, mode, businessDate, productsPath } = opts;
  const dualInput = Boolean(opts.dualInput);
  let txnInputPath = (opts.txnInputPath || '').trim();
  let rateInputPath = (opts.rateInputPath || '').trim();
  let eventsInputPath = (opts.eventsInputPath || '').trim();
  let catalogInputPath = (opts.catalogInputPath || '').trim();
  const gradeScript = (opts.gradeScript || '').trim();
  const outputFormat =
    opts.outputFormat === 'parquet' || opts.outputFormat === 'csv'
      ? opts.outputFormat
      : 'json';
  const testcasesPrefix = (opts.testcasesPrefix || '').trim();
  const cases = Array.isArray(opts.cases)
    ? opts.cases.map(String).filter(Boolean)
    : [];
  const gradeKeys = Array.isArray(opts.gradeKeys)
    ? opts.gradeKeys.map(String).filter(Boolean)
    : ['transaction_id'];
  let evalSolutionPath = (opts.evalSolutionPath || '').trim();
  let inputPath = (opts.inputPath || '').trim();
  let inputAPath = '';
  let inputBPath = '';

  if (!session.workspacePrefix) {
    throw Object.assign(new Error('session has no workspacePrefix'), { status: 400 });
  }

  const jobId = uuidv4();
  const owner = workspaceStore.sanitizeOwner(session.userId || 'anonymous');
  const root = workspaceRootFromPrefix(session.workspacePrefix);
  const entrypoint = safeWorkspacePy(
    opts.entrypoint || session.entrypoint,
    session.entrypoint || 'src/main.py',
  );
  const projectPrefix = session.workspacePrefix;
  const jobAppPrefix = `${root}/jobs/${jobId}/app`;
  const manifestKey = `${root}/jobs/${jobId}/manifest.json`;
  const stagedInputPrefix = `${root}/jobs/${jobId}/staged-input`;
  const stagedInputBPrefix = `${root}/jobs/${jobId}/staged-input-b`;
  const outputPath =
    outputFormat === 'parquet' || outputFormat === 'csv'
      ? s3aKey(`${root}/results/${jobId}/`)
      : s3aKey(`${root}/results/${jobId}/solution.json`);
  // Stable scratch dump for playground experiments (reuse across Runs).
  const playgroundDumpPath =
    session.challengeId === 'spark-playground'
      ? s3aKey(`${root}/dump/`)
      : null;
  const mainFile = s3aKey(`${jobAppPrefix}/${entrypoint}`);
  const k8sName = dnsJobName(owner, jobId, mode);

  const snap = await snapshotProject(projectPrefix, jobAppPrefix);
  const store = getObjectStore();
  const entryObj = await store.getObject(normalizeKey(`${jobAppPrefix}/${entrypoint}`));
  if (!entryObj) {
    throw Object.assign(
      new Error(`entrypoint not found in workspace: ${entrypoint}`),
      { status: 400 },
    );
  }

  let stagedFiles = 0;
  if (testcasesPrefix && cases.length) {
    if (dualInput) {
      const stagedA = await stageTestcaseInputs(
        store,
        testcasesPrefix,
        cases,
        stagedInputPrefix,
        'input',
      );
      const stagedB = await stageTestcaseInputs(
        store,
        testcasesPrefix,
        cases,
        stagedInputBPrefix,
        'input_b',
      );
      inputAPath = stagedA.inputPathS3a;
      inputBPath = stagedB.inputPathS3a;
      // Compat: INPUT_PATH points at side A for labs that only read one path by mistake.
      inputPath = inputAPath;
      stagedFiles = stagedA.stagedFiles + stagedB.stagedFiles;
    } else {
      const staged = await stageTestcaseInputs(
        store,
        testcasesPrefix,
        cases,
        stagedInputPrefix,
        'input',
      );
      inputPath = staged.inputPathS3a;
      stagedFiles = staged.stagedFiles;
    }
    // Grade against canonical testcases/ (per-case expected/).
    evalSolutionPath = testcasesPrefix;
  }

  const playgroundTrail = session.challengeId === 'spark-playground';
  const labSpec = playgroundTrail ? null : await loadLabPlatformSpec(session.challengeId);
  if (labSpec) {
    if (mode === 'run') {
      txnInputPath = String(labSpec.runTxnInputPath || labSpec.txnInputPath || txnInputPath).trim();
      rateInputPath = String(labSpec.runRateInputPath || labSpec.rateInputPath || rateInputPath).trim();
      eventsInputPath = String(
        labSpec.runEventsInputPath || labSpec.eventsInputPath || eventsInputPath,
      ).trim();
      catalogInputPath = String(
        labSpec.runCatalogInputPath || labSpec.catalogInputPath || catalogInputPath,
      ).trim();
    } else {
      txnInputPath = String(labSpec.txnInputPath || txnInputPath).trim();
      rateInputPath = String(labSpec.rateInputPath || rateInputPath).trim();
      eventsInputPath = String(labSpec.eventsInputPath || eventsInputPath).trim();
      catalogInputPath = String(labSpec.catalogInputPath || catalogInputPath).trim();
    }
  }

  if (eventsInputPath && catalogInputPath) {
    inputAPath = eventsInputPath;
    inputBPath = catalogInputPath;
  }

  const namedInputs =
    Boolean(txnInputPath && rateInputPath) || Boolean(eventsInputPath && catalogInputPath);
  if (!inputPath && !(inputAPath && inputBPath) && !playgroundTrail && !namedInputs) {
    throw Object.assign(
      new Error(
        'inputPath is required (or provide testcasesPrefix + cases, txnInputPath + rateInputPath, or eventsInputPath + catalogInputPath)',
      ),
      { status: 400 },
    );
  }

  const manifest = {
    jobId,
    mode,
    sessionId: session.id,
    challengeId: session.challengeId,
    userId: owner,
    entrypoint,
    businessDate,
    inputPath,
    outputPath,
    outputFormat,
    evalSolutionPath: evalSolutionPath || null,
    testcasesPrefix: testcasesPrefix || null,
    cases,
    gradeKeys,
    stagedFiles,
    txnInputPath: txnInputPath || null,
    rateInputPath: rateInputPath || null,
    eventsInputPath: eventsInputPath || null,
    catalogInputPath: catalogInputPath || null,
    gradeScript: gradeScript || null,
    mainApplicationFile: mainFile,
    snapshotFiles: snap.files,
    k8sName,
    createdAt: Date.now(),
    contentFingerprint: createHash('sha256')
      .update(`${session.id}:${jobId}:${snap.files}:${entrypoint}`)
      .digest('hex')
      .slice(0, 16),
  };
  await writeManifest(manifestKey, manifest);

  // Playground is an experiment bench — allow a wider trail than scored labs.
  // Scored labs lock driver/executor size and fixed spark_conf from the challenge spec;
  // only declared knobs may overlay.
  const clientLimits = opts.limits;
  const lockedLimits = playgroundTrail ? clientLimits : (labSpec?.limits || clientLimits);
  const maxDriverCores = playgroundTrail ? 4 : 2;
  const maxExecutors = playgroundTrail ? 8 : 4;
  const maxExecutorCores = playgroundTrail ? 4 : 2;
  const driverCores = clampInt(lockedLimits?.driver, 1, maxDriverCores, 1);
  const driverMemory = String(lockedLimits?.driverMemory || '1g');
  const executors = clampInt(lockedLimits?.executors, 1, maxExecutors, 2);
  const executorCores = clampInt(lockedLimits?.executorCores, 1, maxExecutorCores, 1);
  const executorMemory = String(lockedLimits?.executorMemory || '1g');
  const hardTimeoutSeconds = resolveHardTimeoutSeconds(playgroundTrail, lockedLimits);

  // Do not attach sibling .py files as --py-files. Spark Platform maps those
  // to spark.yarn.dist.pyFiles; the submitter then opens s3a:// before
  // hadoop-aws is on its classpath (Ivy --packages) and dies with
  // ClassNotFoundException: S3AFileSystem. Alternate entrypoints
  // (naive_sol.py, versions/*.py) are the chosen main file, not deps.
  const depsPy: string[] = [];

  const sparkConf: Record<string, string> = {};
  if (playgroundTrail) {
    sparkConf['spark.sql.adaptive.enabled'] = clientLimits?.aqe === false ? 'false' : 'true';
    sparkConf['spark.sql.shuffle.partitions'] = String(
      Math.min(512, Math.max(1, Number(clientLimits?.shufflePartitions) || 8)),
    );
  } else {
    Object.assign(sparkConf, parseSparkConfMap(labSpec?.sparkConf));
    const specLimits = labSpec?.limits;
    if (sparkConf['spark.sql.adaptive.enabled'] == null && typeof specLimits?.aqe === 'boolean') {
      sparkConf['spark.sql.adaptive.enabled'] = specLimits.aqe ? 'true' : 'false';
    }
    if (sparkConf['spark.sql.shuffle.partitions'] == null && specLimits?.shufflePartitions != null) {
      sparkConf['spark.sql.shuffle.partitions'] = String(
        Math.min(512, Math.max(1, Number(specLimits.shufflePartitions) || 8)),
      );
    }
    if (
      sparkConf['spark.sql.adaptive.skewJoin.enabled'] == null
      && typeof specLimits?.skewJoin === 'boolean'
    ) {
      sparkConf['spark.sql.adaptive.skewJoin.enabled'] = specLimits.skewJoin ? 'true' : 'false';
    }
    if (
      sparkConf['spark.sql.autoBroadcastJoinThreshold'] == null
      && specLimits?.autoBroadcastJoinThreshold != null
      && String(specLimits.autoBroadcastJoinThreshold).trim()
    ) {
      sparkConf['spark.sql.autoBroadcastJoinThreshold'] = String(
        specLimits.autoBroadcastJoinThreshold,
      ).trim();
    }
    Object.assign(sparkConf, applyDeclaredKnobs(opts.sparkKnobs, labSpec?.knobs));
  }

  const platformBody = {
    name: k8sName,
    user: owner,
    type: 'Python',
    main_application_file: mainFile,
    python_version: '3',
    executor_instances: executors,
    executor_cores: executorCores,
    executor_memory: executorMemory,
    driver_cores: driverCores,
    driver_memory: driverMemory,
    deps_py_files: depsPy,
    hard_timeout_seconds: hardTimeoutSeconds,
    ...(Object.keys(sparkConf).length ? { spark_conf: sparkConf } : {}),
    env: {
      BUSINESS_DATE: businessDate,
      ...(inputPath ? { INPUT_PATH: inputPath } : {}),
      OUTPUT_PATH: outputPath,
      ...(playgroundDumpPath ? { DUMP_PATH: playgroundDumpPath } : {}),
      ...(productsPath && String(productsPath).trim()
        ? { PRODUCTS_PATH: String(productsPath).trim() }
        : {}),
      ...(txnInputPath ? { TXN_INPUT_PATH: txnInputPath } : {}),
      ...(rateInputPath ? { RATE_INPUT_PATH: rateInputPath } : {}),
      ...(inputAPath && inputBPath
        ? { INPUT_A_PATH: inputAPath, INPUT_B_PATH: inputBPath }
        : {}),
      ...(playgroundTrail
        ? {
            SPARK_AQE: clientLimits?.aqe === false ? 'false' : 'true',
            SPARK_SHUFFLE_PARTITIONS: String(
              Math.min(512, Math.max(1, Number(clientLimits?.shufflePartitions) || 8)),
            ),
          }
        : {}),
    },
  };

  const submittedAt = Date.now();
  const gradeStatus = mode === 'submit' ? 'pending' : null;
  await pool.query(
    `INSERT INTO submissions
       (id, session_id, challenge_id, user_id, mode, k8s_name, status,
        entrypoint, input_path, output_path, report_path, results_path, app_prefix,
        manifest_key, platform_job, error, logs, grade_status, submitted_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      jobId,
      session.id,
      session.challengeId,
      owner,
      mode,
      k8sName,
      'submitted',
      entrypoint,
      inputPath,
      outputPath,
      null,
      evalSolutionPath || null,
      jobAppPrefix,
      manifestKey,
      null,
      null,
      JSON.stringify([
        'Snapshot written',
        cases.length
          ? `Staged ${stagedFiles} testcase input file(s): ${cases.join(', ')}`
          : inputPath
            ? 'Using provided INPUT_PATH'
            : 'No INPUT_PATH — job must use paths from code',
        ...(playgroundDumpPath ? [`DUMP_PATH=${playgroundDumpPath}`] : []),
        `Submitting ${k8sName} to Spark Platform…`,
        mode === 'submit'
          ? 'Submit mode — will row-diff against each testcase expected/ when Spark succeeds'
          : 'Run mode — output for your validation (not a scored submission)',
      ]),
      gradeStatus,
      submittedAt,
      submittedAt,
    ],
  );

  let platformJob: unknown = null;
  try {
    const res = await platformFetch('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(platformBody),
    });
    if (res.status >= 400) {
      const detail =
        (res.json as { detail?: string } | undefined)?.detail
        || res.text
        || `Spark Platform error ${res.status}`;
      await pool.query(
        `UPDATE submissions SET status='failed', error=$2, updated_at=$3 WHERE id=$1`,
        [jobId, String(detail), Date.now()],
      );
      throw Object.assign(new Error(String(detail)), { status: 502 });
    }
    platformJob = (res.json as { job?: unknown })?.job || res.json;
    await pool.query(
      `UPDATE submissions
          SET status=$2, platform_job=$3, logs=$4, updated_at=$5
        WHERE id=$1`,
      [
        jobId,
        mapPlatformStatus((platformJob as { status?: string })?.status),
        JSON.stringify(platformJob),
        JSON.stringify([
          'Snapshot written',
          `Submitted SparkApplication ${k8sName}`,
          `mainApplicationFile=${mainFile}`,
          mode === 'submit'
            ? 'Submit mode — will evaluate against expected output when Spark succeeds'
            : 'Run mode — output for your validation (not a scored submission)',
        ]),
        Date.now(),
      ],
    );
  } catch (e: unknown) {
    if ((e as { status?: number }).status === 502) throw e;
    const msg = (e as Error).message || 'Failed to reach Spark Platform API';
    await pool.query(
      `UPDATE submissions SET status='failed', error=$2, updated_at=$3 WHERE id=$1`,
      [jobId, msg, Date.now()],
    );
    throw Object.assign(new Error(msg), { status: 502 });
  }

  return publicJob(await getJobRow(jobId));
}

async function getJobRow(jobId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(`SELECT * FROM submissions WHERE id = $1`, [jobId]);
  return rows[0] || null;
}

function publicJob(row: Record<string, unknown> | null): Record<string, unknown> {
  if (!row) return {};
  const logs = parseJobLogs(row.logs);
  let gradeResult: unknown = row.grade_result;
  if (typeof gradeResult === 'string') {
    try { gradeResult = JSON.parse(gradeResult); } catch { gradeResult = null; }
  }
  const platformJob = parsePlatformJob(row.platform_job);
  const debug = sparkDebugLinks(platformJob, logs);
  const runMetrics = parseRunMetrics(row.run_metrics);
  const wallMs =
    row.finished_at && row.submitted_at
      ? Math.max(0, Number(row.finished_at) - Number(row.submitted_at))
      : null;
  return {
    id: row.id,
    sessionId: row.session_id,
    mode: row.mode,
    name: row.k8s_name,
    status: row.status,
    entrypoint: row.entrypoint,
    inputPath: row.input_path,
    outputPath: row.output_path,
    reportPath: row.report_path || null,
    evalSolutionPath: row.results_path,
    resultsPath: row.results_path,
    appPrefix: row.app_prefix,
    error: row.error,
    logs,
    gradeStatus: row.grade_status || null,
    gradeResult: gradeResult || null,
    gradedAt: row.graded_at ? Number(row.graded_at) : null,
    submittedAt: Number(row.submitted_at) || null,
    finishedAt: row.finished_at ? Number(row.finished_at) : null,
    wallDurationMs: wallMs,
    /** Prefer this — Spark jobs wall from History (excludes image pull / pod setup). */
    executionDurationMs: runMetrics?.sparkJobsDurationMs ?? null,
    sparkAppDurationMs: runMetrics?.sparkAppDurationMs ?? null,
    sparkJobCount: runMetrics?.sparkJobCount ?? null,
    runMetrics,
    applicationId: debug.applicationId,
    historyUrl: debug.historyUrl,
    historyServerUrl: debug.historyServerUrl,
    platformJob,
  };
}

async function maybeGradeJob(jobId: string): Promise<void> {
  const row = await getJobRow(jobId);
  if (!row) return;
  if (String(row.mode) !== 'submit') return;
  if (String(row.status) !== 'succeeded') {
    if (String(row.status) === 'failed' && row.grade_status === 'pending') {
      const sparkErr = String(row.error || '').trim();
      const timedOut = /hard threshold has reached/i.test(sparkErr);
      const summary = timedOut
        ? sparkErr
        : (sparkErr || 'Spark application failed');
      const failedGrade = await scoreGradeForJob(jobId, {
        passed: false,
        kind: 'submission',
        summary,
        checks: [{
          id: 'spark_status',
          label: timedOut ? 'Finished within hard time limit' : 'Spark application succeeded',
          passed: false,
          detail: sparkErr || undefined,
        }],
        gradedAt: Date.now(),
      });
      await pool.query(
        `UPDATE submissions
            SET grade_status='failed',
                grade_result=$2,
                graded_at=$3,
                updated_at=$3
          WHERE id=$1`,
        [jobId, JSON.stringify(failedGrade), Date.now()],
      );
    }
    return;
  }
  if (row.grade_status === 'passed' || row.grade_status === 'failed') return;
  if (!row.results_path) {
    await pool.query(
      `UPDATE submissions
          SET grade_status='failed',
              grade_result=$2,
              graded_at=$3,
              updated_at=$3
        WHERE id=$1`,
      [
        jobId,
        JSON.stringify({
          passed: false,
          kind: 'submission',
          summary: 'No expected/eval path configured for challenge',
          checks: [],
          gradedAt: Date.now(),
        }),
        Date.now(),
      ],
    );
    return;
  }

  await pool.query(
    `UPDATE submissions SET grade_status='grading', updated_at=$2 WHERE id=$1`,
    [jobId, Date.now()],
  );

  try {
    let gradeCases: string[] | undefined;
    let gradeKeys: string[] | undefined;
    let gradeScript: string | undefined;
    try {
      const manBuf = row.manifest_key
        ? await getObjectStore().getObject(normalizeKey(String(row.manifest_key)))
        : null;
      if (manBuf) {
        const man = JSON.parse(manBuf.toString('utf8')) as {
          cases?: string[];
          gradeKeys?: string[];
          gradeScript?: string;
        };
        if (Array.isArray(man.cases) && man.cases.length) gradeCases = man.cases.map(String);
        if (Array.isArray(man.gradeKeys) && man.gradeKeys.length) {
          gradeKeys = man.gradeKeys.map(String);
        }
        if (typeof man.gradeScript === 'string' && man.gradeScript.trim()) {
          gradeScript = man.gradeScript.trim();
        }
      }
    } catch {
      /* fall back to directory-style expected/ */
    }

    const grade = await scoreGradeForJob(
      jobId,
      await gradeOutputAgainstSolution({
        candidateOutputS3a: String(row.output_path),
        evalSolutionS3a: String(row.results_path),
        kind: 'submission',
        sparkSucceeded: true,
        gradeCases,
        gradeKeys,
        gradeScript,
      }),
    );
    const lines = (() => {
      try {
        return typeof row.logs === 'string' ? JSON.parse(row.logs as string) : (row.logs as string[]) || [];
      } catch {
        return [];
      }
    })() as string[];
    const gradeLines = [
      '',
      '── Evaluation ──',
      grade.summary,
      ...grade.checks.map(
        (c: { passed: boolean; label: string; detail?: string }) =>
          `${c.passed ? '✓' : '✗'} ${c.label}${c.detail ? ` (${c.detail})` : ''}`,
      ),
    ];
    await pool.query(
      `UPDATE submissions
          SET grade_status=$2,
              grade_result=$3,
              graded_at=$4,
              logs=$5,
              updated_at=$4
        WHERE id=$1`,
      [
        jobId,
        grade.passed ? 'passed' : 'failed',
        JSON.stringify(grade),
        grade.gradedAt,
        JSON.stringify([...lines, ...gradeLines].slice(-400)),
      ],
    );
  } catch (e: unknown) {
    const msg = (e as Error).message || 'grading failed';
    await pool.query(
      `UPDATE submissions
          SET grade_status='failed',
              grade_result=$2,
              graded_at=$3,
              updated_at=$3
        WHERE id=$1`,
      [
        jobId,
        JSON.stringify({
          passed: false,
          kind: 'submission',
          summary: msg,
          checks: [{ id: 'grader', label: 'Evaluation ran', passed: false, detail: msg }],
          gradedAt: Date.now(),
        }),
        Date.now(),
      ],
    );
  }
}

const KILLED_BY_USER = 'Killed by user';

async function killSparkJob(
  jobId: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const row = await getJobRow(jobId);
  if (!row || String(row.session_id) !== sessionId) {
    throw Object.assign(new Error('job not found'), { status: 404 });
  }
  const status = String(row.status || '');
  if (status === 'succeeded' || status === 'failed') {
    return publicJob(row);
  }

  const k8sName = String(row.k8s_name || '').trim();
  if (k8sName) {
    try {
      await platformFetch(`/api/jobs/${encodeURIComponent(k8sName)}`, { method: 'DELETE' });
    } catch {
      /* Platform down — still settle the row so the UI is not stuck. */
    }
  }

  const now = Date.now();
  const prev = parsePlatformJob(row.platform_job) || {};
  const merged = {
    ...prev,
    status: 'FAILED',
    rawStatus: 'FAILED',
    finish: new Date(now).toISOString(),
    error: KILLED_BY_USER,
  };
  await pool.query(
    `UPDATE submissions
        SET status='failed',
            error=$2,
            finished_at=COALESCE(finished_at, $3),
            platform_job=$4,
            updated_at=$3
      WHERE id=$1`,
    [jobId, KILLED_BY_USER, now, JSON.stringify(merged)],
  );
  await maybeGradeJob(jobId);
  return publicJob(await getJobRow(jobId));
}

async function refreshJobFromPlatform(jobId: string): Promise<Record<string, unknown>> {
  await resolveHistoryBase();
  const row = await getJobRow(jobId);
  if (!row) {
    throw Object.assign(new Error('job not found'), { status: 404 });
  }
  const k8sName = String(row.k8s_name);
  try {
    const statusRes = await platformFetch(`/api/jobs/${encodeURIComponent(k8sName)}`);
    if (statusRes.status === 404) {
      const current = String(row.status || '');
      if (current !== 'succeeded' && current !== 'failed') {
        await pool.query(
          `UPDATE submissions
              SET status='failed',
                  error=COALESCE(error, $2),
                  finished_at=COALESCE(finished_at, $3),
                  updated_at=$3
            WHERE id=$1`,
          [jobId, 'Hard threshold has reached so killing this Job', Date.now()],
        );
      }
    } else if (statusRes.status === 200 && statusRes.json) {
      const pjRaw = statusRes.json as { status?: string; error?: string };
      const status = mapPlatformStatus(pjRaw.status);
      const finished =
        status === 'succeeded' || status === 'failed' ? Date.now() : null;
      // Preserve previously discovered applicationId if Platform omits it.
      const prev = parsePlatformJob(row.platform_job);
      const prevId = String(prev?.applicationId || prev?.sparkApplicationId || '').trim() || null;
      const merged = mergeApplicationIdIntoPlatformJob(
        parsePlatformJob(pjRaw),
        prevId,
      );
      await pool.query(
        `UPDATE submissions
            SET status=$2, platform_job=$3, error=COALESCE($4, error),
                finished_at=COALESCE($5, finished_at), updated_at=$6
          WHERE id=$1`,
        [
          jobId,
          status,
          JSON.stringify(merged || pjRaw),
          pjRaw.error || null,
          finished,
          Date.now(),
        ],
      );
    }
    const logsRes = await platformFetch(
      `/api/jobs/${encodeURIComponent(k8sName)}/logs?tail=200`,
    );
    if (logsRes.text != null && logsRes.status < 500) {
      const fresh = await getJobRow(jobId);
      const lines = String(logsRes.text).split(/\r\n|\n|\r/).filter(Boolean);
      const existing = parseJobLogs(fresh?.logs);
      const header = existing.filter(
        (l) =>
          l.startsWith('Snapshot')
          || l.startsWith('Submitted')
          || l.startsWith('mainApplication')
          || l.startsWith('Submit mode')
          || l.startsWith('Run mode')
          || l.startsWith('── Evaluation')
          || l.startsWith('✓')
          || l.startsWith('✗')
          || l.startsWith('Passed')
          || l.startsWith('Failed'),
      );
      const evalIdx = existing.findIndex((l) => l.startsWith('── Evaluation'));
      const preservedEval = evalIdx >= 0 ? existing.slice(evalIdx) : [];
      const nextLogs = [
        ...header.filter((l) => !l.startsWith('──') && !l.startsWith('✓') && !l.startsWith('✗') && !l.startsWith('Passed') && !l.startsWith('Failed')),
        ...lines,
        ...preservedEval,
      ].slice(-400);
      const appId = sparkDebugLinks(fresh?.platform_job, nextLogs).applicationId;
      const pj = mergeApplicationIdIntoPlatformJob(parsePlatformJob(fresh?.platform_job), appId);
      await pool.query(
        `UPDATE submissions SET logs=$2, platform_job=COALESCE($3, platform_job), updated_at=$4 WHERE id=$1`,
        [
          jobId,
          JSON.stringify(nextLogs),
          pj ? JSON.stringify(pj) : null,
          Date.now(),
        ],
      );
    }
  } catch (_e) {
    // Platform unreachable — return last known row
  }

  await ensureRunMetrics(jobId);
  await maybeGradeJob(jobId);
  const settled = await getJobRow(jobId);
  if (settled && (String(settled.status) === 'succeeded' || String(settled.status) === 'failed')) {
    await ensureRunMetrics(jobId);
    await maybeRescoreExecution(jobId);
  }
  return publicJob(await getJobRow(jobId));
}

async function listJobsForSession(sessionId: string): Promise<Record<string, unknown>[]> {
  await resolveHistoryBase();
  const { rows } = await pool.query(
    `SELECT * FROM submissions WHERE session_id = $1 ORDER BY submitted_at DESC LIMIT 50`,
    [sessionId],
  );
  // Backfill History execution metrics for recent settled jobs (cap to keep list snappy).
  const toEnrich = (rows as Record<string, unknown>[])
    .filter((r) => {
      const st = String(r.status || '');
      if (st !== 'succeeded' && st !== 'failed') return false;
      const m = parseRunMetrics(r.run_metrics);
      return !(m?.sparkJobsDurationMs != null || m?.sparkAppDurationMs != null);
    })
    .slice(0, 8);
  await Promise.all(toEnrich.map((r) => ensureRunMetrics(String(r.id)).catch(() => null)));
  const fresh = toEnrich.length
    ? (await pool.query(
      `SELECT * FROM submissions WHERE session_id = $1 ORDER BY submitted_at DESC LIMIT 50`,
      [sessionId],
    )).rows
    : rows;
  return (fresh as Record<string, unknown>[]).map((r) => publicJob(r));
}

async function listSubmissionsForSession(sessionId: string): Promise<Record<string, unknown>[]> {
  await resolveHistoryBase();
  const { rows } = await pool.query(
    `SELECT * FROM submissions
       WHERE session_id = $1 AND mode = 'submit'
       ORDER BY submitted_at DESC LIMIT 50`,
    [sessionId],
  );
  const enriched = await Promise.all(
    (rows as Record<string, unknown>[]).slice(0, 20).map(async (r) => {
      const id = String(r.id);
      const status = String(r.status || '');
      if (status === 'succeeded' || status === 'failed') {
        await ensureRunMetrics(id).catch(() => null);
        await maybeRescoreExecution(id).catch(() => null);
      }
      const fresh = (await getJobRow(id)) || r;
      const pub = publicJob(fresh);
      if (pub.applicationId) return pub;
      return enrichJobDebug(id);
    }),
  );
  // Any beyond the enrich cap (unlikely at LIMIT 50 with slice 20): map as-is.
  const rest = (rows as Record<string, unknown>[]).slice(20).map((r) => publicJob(r));
  return [...enriched, ...rest];
}

const SNAPSHOT_TEXT_EXT = new Set([
  'py', 'md', 'txt', 'json', 'yml', 'yaml', 'sql', 'sh', 'toml',
  'cfg', 'ini', 'xml', 'csv', 'r', 'scala', 'java', 'js', 'ts', 'properties',
]);

async function listJobAppFiles(
  jobId: string,
  sessionId: string,
): Promise<{ jobId: string; name: string; entrypoint: string; files: Record<string, string> }> {
  const row = await getJobRow(jobId);
  if (!row || String(row.session_id) !== sessionId) {
    throw Object.assign(new Error('job not found'), { status: 404 });
  }
  const prefix = normalizeKey(String(row.app_prefix || '')).replace(/\/?$/, '/');
  if (!prefix || prefix === '/') {
    throw Object.assign(new Error('submission snapshot not found'), { status: 404 });
  }
  const store = getObjectStore();
  const keys = await store.listKeys(prefix);
  const files: Record<string, string> = {};
  let n = 0;
  for (const key of keys) {
    if (!key.startsWith(prefix) || key.endsWith('/')) continue;
    const rel = key.slice(prefix.length);
    if (!rel || rel.includes('__pycache__') || rel.endsWith('.pyc') || rel.endsWith('.crc')) continue;
    const ext = (rel.split('.').pop() || '').toLowerCase();
    if (ext && !SNAPSHOT_TEXT_EXT.has(ext)) continue;
    if (n >= 40) break;
    const buf = await store.getObject(key);
    if (!buf || buf.length > 512 * 1024 || buf.includes(0)) continue;
    files[rel] = buf.toString('utf8');
    n += 1;
  }
  return {
    jobId: String(row.id),
    name: String(row.k8s_name || row.id),
    entrypoint: String(row.entrypoint || 'src/main.py').replace(/^\/+/, ''),
    files,
  };
}

module.exports = {
  startSparkJob,
  refreshJobFromPlatform,
  killSparkJob,
  listJobsForSession,
  listSubmissionsForSession,
  listJobAppFiles,
  getJobRow,
  publicJob,
  maybeGradeJob,
  enrichJobDebug,
};
