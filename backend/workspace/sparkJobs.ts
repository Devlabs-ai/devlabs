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
  /** json (default) → results/<id>/solution.json; parquet → results/<id>/ */
  outputFormat?: 'json' | 'parquet';
  /** Optional products dimension path → env PRODUCTS_PATH. */
  productsPath?: string;
  /**
   * When true with testcasesPrefix+cases: stage input/ → INPUT_A_PATH and
   * input_b/ → INPUT_B_PATH (merge / dual-drop labs).
   */
  dualInput?: boolean;
  limits?: SparkJobLimits;
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
  const { session, mode, businessDate, limits, productsPath } = opts;
  const dualInput = Boolean(opts.dualInput);
  const outputFormat = opts.outputFormat === 'parquet' ? 'parquet' : 'json';
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
  const entrypoint = (session.entrypoint || 'src/main.py').replace(/^\/+/, '');
  const projectPrefix = session.workspacePrefix;
  const jobAppPrefix = `${root}/jobs/${jobId}/app`;
  const manifestKey = `${root}/jobs/${jobId}/manifest.json`;
  const stagedInputPrefix = `${root}/jobs/${jobId}/staged-input`;
  const stagedInputBPrefix = `${root}/jobs/${jobId}/staged-input-b`;
  const outputPath =
    outputFormat === 'parquet'
      ? s3aKey(`${root}/results/${jobId}/`)
      : s3aKey(`${root}/results/${jobId}/solution.json`);
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

  if (!inputPath && !(dualInput && inputAPath && inputBPath)) {
    throw Object.assign(
      new Error('inputPath is required (or provide testcasesPrefix + cases)'),
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

  const driverCores = Math.min(2, Math.max(1, limits?.driver ?? 1));
  const driverMemory = limits?.driverMemory || '1g';
  const executors = Math.min(4, Math.max(1, limits?.executors ?? 2));
  const executorCores = Math.min(2, Math.max(1, limits?.executorCores ?? 1));
  const executorMemory = limits?.executorMemory || '1g';

  const depsPy = snap.pyRelPaths
    .filter((rel) => rel !== entrypoint)
    .map((rel) => s3aKey(`${jobAppPrefix}/${rel}`));

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
    env: {
      BUSINESS_DATE: businessDate,
      INPUT_PATH: inputPath,
      OUTPUT_PATH: outputPath,
      ...(productsPath && String(productsPath).trim()
        ? { PRODUCTS_PATH: String(productsPath).trim() }
        : {}),
      ...(dualInput && inputAPath && inputBPath
        ? { INPUT_A_PATH: inputAPath, INPUT_B_PATH: inputBPath }
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
          : 'Using provided INPUT_PATH',
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
            summary: 'Spark application failed',
            checks: [{ id: 'spark_status', label: 'Spark application succeeded', passed: false }],
            gradedAt: Date.now(),
          }),
          Date.now(),
        ],
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
    try {
      const manBuf = row.manifest_key
        ? await getObjectStore().getObject(normalizeKey(String(row.manifest_key)))
        : null;
      if (manBuf) {
        const man = JSON.parse(manBuf.toString('utf8')) as {
          cases?: string[];
          gradeKeys?: string[];
        };
        if (Array.isArray(man.cases) && man.cases.length) gradeCases = man.cases.map(String);
        if (Array.isArray(man.gradeKeys) && man.gradeKeys.length) {
          gradeKeys = man.gradeKeys.map(String);
        }
      }
    } catch {
      /* fall back to directory-style expected/ */
    }

    const grade = await gradeOutputAgainstSolution({
      candidateOutputS3a: String(row.output_path),
      evalSolutionS3a: String(row.results_path),
      kind: 'submission',
      sparkSucceeded: true,
      gradeCases,
      gradeKeys,
    });
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

async function refreshJobFromPlatform(jobId: string): Promise<Record<string, unknown>> {
  await resolveHistoryBase();
  const row = await getJobRow(jobId);
  if (!row) {
    throw Object.assign(new Error('job not found'), { status: 404 });
  }
  const k8sName = String(row.k8s_name);
  try {
    const statusRes = await platformFetch(`/api/jobs/${encodeURIComponent(k8sName)}`);
    if (statusRes.status === 200 && statusRes.json) {
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
      const lines = String(logsRes.text).split('\n').filter(Boolean);
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

  await maybeGradeJob(jobId);
  return publicJob(await getJobRow(jobId));
}

async function listJobsForSession(sessionId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT * FROM submissions WHERE session_id = $1 ORDER BY submitted_at DESC LIMIT 50`,
    [sessionId],
  );
  return rows.map((r: Record<string, unknown>) => publicJob(r));
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
      const pub = publicJob(r);
      if (pub.applicationId) return pub;
      return enrichJobDebug(String(r.id));
    }),
  );
  // Any beyond the enrich cap (unlikely at LIMIT 50 with slice 20): map as-is.
  const rest = (rows as Record<string, unknown>[]).slice(20).map((r) => publicJob(r));
  return [...enriched, ...rest];
}

module.exports = {
  startSparkJob,
  refreshJobFromPlatform,
  listJobsForSession,
  listSubmissionsForSession,
  getJobRow,
  publicJob,
  maybeGradeJob,
  enrichJobDebug,
};
