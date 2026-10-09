import axios from 'axios';
import { getAuthHeader } from './authApi';
import { labClientId } from './labTabLease';
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
  opts: { force?: boolean } = {},
): Promise<SparkSessionStartResult> {
  const body: Record<string, unknown> = {
    challengeId,
    clientId: labClientId(),
    force: Boolean(opts.force),
  };
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

export async function startK8sSession(
  challengeId: string,
  opts: { force?: boolean } = {},
): Promise<K8sSessionStartResult> {
  const { data } = await axios.post(
    '/api/session/k8s/start',
    { challengeId, clientId: labClientId(), force: Boolean(opts.force) },
    { headers: getAuthHeader() },
  );
  const payload = data as K8sSessionStartResult;
  return {
    ...payload,
    terminalWsUrl: rewriteWsUrl(payload.terminalWsUrl),
  };
}

export interface K8sLabAvailability {
  available: boolean;
  message: string | null;
}

/** Whether a cluster lab's node pool is up; checked before starting a session. */
export async function fetchK8sAvailability(challengeId: string): Promise<K8sLabAvailability> {
  const { data } = await axios.get('/api/session/k8s/availability', {
    params: { challengeId },
    headers: getAuthHeader(),
  });
  const d = data as Partial<K8sLabAvailability>;
  return { available: d.available !== false, message: d.message ?? null };
}

export interface K8sCapacityWait {
  pod: string;
  waitingSeconds: number;
}

export interface K8sCapacityState {
  /** Learner pods waiting for a node. */
  waiting: K8sCapacityWait[];
  /** Seconds the lab open has been held for its reserved capacity, or null. */
  reservingSeconds: number | null;
}

/** Capacity waits for the learner's lab (works before the lab has a session id). */
export async function fetchK8sCapacity(): Promise<K8sCapacityState> {
  const { data } = await axios.get('/api/session/k8s/capacity', { headers: getAuthHeader() });
  const d = data as Partial<K8sCapacityState>;
  return { waiting: d.waiting || [], reservingSeconds: d.reservingSeconds ?? null };
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

export interface K8sLabFile {
  name: string;
  /** Relative to the lab home, e.g. "manifests/web.yaml". */
  path: string;
  size: number;
  updatedAt: number;
}

export interface K8sLabDirListing {
  dir: string;
  folders: string[];
  files: K8sLabFile[];
}

export async function listK8sDir(sessionId: string, dir: string): Promise<K8sLabDirListing> {
  const { data } = await axios.get(`/api/session/${sessionId}/k8s/files`, {
    headers: getAuthHeader(),
    params: { dir },
  });
  return data as K8sLabDirListing;
}

export async function listK8sFolders(sessionId: string): Promise<string[]> {
  const { data } = await axios.get(`/api/session/${sessionId}/k8s/folders`, {
    headers: getAuthHeader(),
  });
  return ((data as { folders?: string[] }).folders || []);
}

export async function createK8sFolder(sessionId: string, path: string): Promise<string> {
  const { data } = await axios.post(
    `/api/session/${sessionId}/k8s/folders`,
    { path },
    { headers: getAuthHeader() },
  );
  return (data as { path: string }).path;
}

export async function readK8sFile(sessionId: string, path: string): Promise<string> {
  const { data } = await axios.get(`/api/session/${sessionId}/k8s/file`, {
    headers: getAuthHeader(),
    params: { path },
  });
  return (data as { content: string }).content;
}

export async function saveK8sFile(sessionId: string, path: string, content: string): Promise<K8sLabFile> {
  const { data } = await axios.put(
    `/api/session/${sessionId}/k8s/file`,
    { path, content },
    { headers: getAuthHeader() },
  );
  return (data as { file: K8sLabFile }).file;
}

/** Rename or move a file or folder. */
export async function renameK8sEntry(
  sessionId: string,
  from: string,
  to: string,
): Promise<{ path: string; kind: 'file' | 'folder' }> {
  const { data } = await axios.post(
    `/api/session/${sessionId}/k8s/files/rename`,
    { from, to },
    { headers: getAuthHeader() },
  );
  return data as { path: string; kind: 'file' | 'folder' };
}

export async function deleteK8sFolder(sessionId: string, path: string): Promise<void> {
  await axios.delete(`/api/session/${sessionId}/k8s/folders`, {
    headers: getAuthHeader(),
    params: { path },
  });
}

export async function deleteK8sFile(sessionId: string, path: string): Promise<void> {
  await axios.delete(`/api/session/${sessionId}/k8s/file`, {
    headers: getAuthHeader(),
    params: { path },
  });
}

export async function resetK8sSession(sessionId: string): Promise<void> {
  await axios.post(
    `/api/session/${sessionId}/k8s/reset`,
    {},
    { headers: getAuthHeader() },
  );
}
