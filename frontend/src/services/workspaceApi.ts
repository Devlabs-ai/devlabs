import axios from 'axios';
import { getAuthHeader } from './authApi';
import type { SparkProjectFiles } from '../fixtures/dailyProductSalesL1';
import type { SparkJobRecord } from '../types/domain';

export interface SparkSessionStartResult {
  sessionId: string;
  status: string;
  runtime: string;
  workspacePrefix?: string | null;
  entrypoint?: string | null;
  session?: Record<string, unknown>;
  challenge?: Record<string, unknown>;
}

export interface WorkspacePayload {
  sessionId: string;
  workspacePrefix: string;
  entrypoint: string | null;
  files: SparkProjectFiles;
  manifest: Array<{ path: string; contentHash: string | null; sizeBytes: number; updatedAt: number }>;
  updatedAt: number | null;
}

export async function startSparkSession(
  challengeId: string,
  starterFiles?: SparkProjectFiles | null,
  entrypoint?: string,
): Promise<SparkSessionStartResult> {
  const body: Record<string, unknown> = { challengeId };
  if (starterFiles && Object.keys(starterFiles).length > 0) {
    body.starterFiles = starterFiles;
  }
  if (entrypoint) body.entrypoint = entrypoint;
  const { data } = await axios.post('/api/session/spark/start', body, {
    headers: getAuthHeader(),
  });
  return data as SparkSessionStartResult;
}

export async function fetchWorkspace(sessionId: string): Promise<WorkspacePayload> {
  const { data } = await axios.get(`/api/session/${sessionId}/workspace`, {
    headers: getAuthHeader(),
  });
  return data as WorkspacePayload;
}

export async function putWorkspaceFile(
  sessionId: string,
  path: string,
  content: string,
): Promise<void> {
  await axios.put(
    `/api/session/${sessionId}/workspace/file`,
    { path, content },
    { headers: getAuthHeader() },
  );
}

export async function deleteWorkspaceFile(sessionId: string, path: string): Promise<void> {
  await axios.delete(`/api/session/${sessionId}/workspace/file`, {
    headers: getAuthHeader(),
    data: { path },
  });
}

export async function renameWorkspaceFile(
  sessionId: string,
  from: string,
  to: string,
): Promise<void> {
  await axios.post(
    `/api/session/${sessionId}/workspace/rename`,
    { from, to },
    { headers: getAuthHeader() },
  );
}

export async function resetWorkspace(
  sessionId: string,
  starterFiles?: SparkProjectFiles | null,
): Promise<{ files: SparkProjectFiles; entrypoint: string | null }> {
  const body: Record<string, unknown> = {};
  if (starterFiles && Object.keys(starterFiles).length > 0) {
    body.starterFiles = starterFiles;
  }
  const { data } = await axios.post(`/api/session/${sessionId}/workspace/reset`, body, {
    headers: getAuthHeader(),
  });
  return data as { files: SparkProjectFiles; entrypoint: string | null };
}

export interface StartSparkJobBody {
  mode: 'run' | 'submit';
  /** Legacy direct INPUT_PATH; omit when using testcasesPrefix + cases. */
  inputPath?: string;
  businessDate?: string;
  /** Author expected path, or testcases/ prefix for Parquet row-diff. */
  evalSolutionPath?: string;
  testcasesPrefix?: string;
  cases?: string[];
  gradeKeys?: string[];
  /** Controls OUTPUT_PATH shape (json file vs parquet/csv directory). */
  outputFormat?: 'json' | 'parquet' | 'csv';
  /** Dimension Parquet path → job env PRODUCTS_PATH. */
  productsPath?: string;
  /** Dimension Parquet path → job env DIM_PATH. */
  dimPath?: string;
  /** Fact path → job env TXN_INPUT_PATH. */
  txnInputPath?: string;
  /** Rate-card path → job env RATE_INPUT_PATH. */
  rateInputPath?: string;
  /** Events path → job env INPUT_A_PATH (catalogue dual-input labs). */
  eventsInputPath?: string;
  /** Catalog path → job env INPUT_B_PATH. */
  catalogInputPath?: string;
  /** Per-challenge grader script (s3a). */
  gradeScript?: string;
  /** Stage input/ + input_b/ → INPUT_A_PATH / INPUT_B_PATH. */
  dualInput?: boolean;
  limits?: {
    driver?: number;
    driverMemory?: string;
    executors?: number;
    executorCores?: number;
    executorMemory?: string;
    aqe?: boolean;
    shufflePartitions?: number;
    skewJoin?: boolean;
    autoBroadcastJoinThreshold?: string;
  };
  /** Learner Spark knobs (conf key → value). Backend whitelists against platformSpec.knobs. */
  /** Learner Spark knobs (conf key → value). Backend whitelists against platformSpec.knobs. */
  sparkKnobs?: Record<string, string>;
  /** Workspace-relative .py to use as Spark main for this job. */
  entrypoint?: string;
}

export async function startSparkJob(
  sessionId: string,
  body: StartSparkJobBody,
): Promise<SparkJobRecord> {
  const { data } = await axios.post(
    `/api/session/${sessionId}/spark/jobs`,
    body,
    { headers: getAuthHeader() },
  );
  return data.job as SparkJobRecord;
}

export async function fetchSparkJobs(sessionId: string): Promise<SparkJobRecord[]> {
  const { data } = await axios.get(`/api/session/${sessionId}/spark/jobs`, {
    headers: getAuthHeader(),
  });
  return (data.jobs || []) as SparkJobRecord[];
}

export async function fetchSparkJob(
  sessionId: string,
  jobId: string,
): Promise<SparkJobRecord> {
  const { data } = await axios.get(
    `/api/session/${sessionId}/spark/jobs/${jobId}`,
    { headers: getAuthHeader() },
  );
  return data.job as SparkJobRecord;
}

export async function killSparkJob(
  sessionId: string,
  jobId: string,
): Promise<SparkJobRecord> {
  const { data } = await axios.delete(
    `/api/session/${sessionId}/spark/jobs/${jobId}`,
    { headers: getAuthHeader() },
  );
  return data.job as SparkJobRecord;
}

export async function fetchSparkJobFiles(
  sessionId: string,
  jobId: string,
): Promise<{ jobId: string; name: string; entrypoint: string; files: Record<string, string> }> {
  const { data } = await axios.get(
    `/api/session/${sessionId}/spark/jobs/${jobId}/files`,
    { headers: getAuthHeader() },
  );
  return data as { jobId: string; name: string; entrypoint: string; files: Record<string, string> };
}

export async function fetchSparkSubmissions(sessionId: string): Promise<SparkJobRecord[]> {
  const { data } = await axios.get(`/api/session/${sessionId}/spark/submissions`, {
    headers: getAuthHeader(),
  });
  return (data.submissions || []) as SparkJobRecord[];
}

export interface K8sSessionStartResult {
  sessionId: string;
  status: string;
  runtime: string;
  k8sNamespace?: string | null;
  created?: boolean;
  provisioned?: boolean;
  terminalWsUrl?: string | null;
  session?: Record<string, unknown>;
  challenge?: Record<string, unknown>;
}

function rewriteWsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${u.pathname}${u.search}`;
  } catch (_e) {
    return url;
  }
}

export async function startK8sSession(challengeId: string): Promise<K8sSessionStartResult> {
  const { data } = await axios.post(
    '/api/session/k8s/start',
    { challengeId },
    { headers: getAuthHeader() },
  );
  const payload = data as K8sSessionStartResult;
  return {
    ...payload,
    terminalWsUrl: rewriteWsUrl(payload.terminalWsUrl),
  };
}

export async function execK8sCommand(
  sessionId: string,
  command: string,
): Promise<{ code: number; stdout: string; stderr: string; k8sNamespace?: string }> {
  const { data } = await axios.post(
    `/api/session/${sessionId}/k8s/exec`,
    { command },
    { headers: getAuthHeader() },
  );
  return data as { code: number; stdout: string; stderr: string; k8sNamespace?: string };
}

export async function gradeK8sSession(
  sessionId: string,
): Promise<{
  passed: boolean;
  message: string;
  stdout: string;
  stderr: string;
  submissionId?: string;
  submission?: K8sSubmissionRecord;
}> {
  const { data } = await axios.post(
    `/api/session/${sessionId}/k8s/grade`,
    {},
    { headers: getAuthHeader() },
  );
  return data as {
    passed: boolean;
    message: string;
    stdout: string;
    stderr: string;
    submissionId?: string;
    submission?: K8sSubmissionRecord;
  };
}

export interface K8sSubmissionRecord {
  id: string;
  sessionId: string;
  challengeId: string | null;
  name: string;
  status: string;
  gradeStatus: string | null;
  passed: boolean;
  message: string;
  stdout: string;
  stderr: string;
  submittedAt: number | null;
  gradedAt: number | null;
}

export async function fetchK8sSubmissions(sessionId: string): Promise<K8sSubmissionRecord[]> {
  const { data } = await axios.get(`/api/session/${sessionId}/k8s/submissions`, {
    headers: getAuthHeader(),
  });
  return ((data as { submissions?: K8sSubmissionRecord[] }).submissions || []);
}

export async function resetK8sSession(sessionId: string): Promise<void> {
  await axios.post(
    `/api/session/${sessionId}/k8s/reset`,
    {},
    { headers: getAuthHeader() },
  );
}
