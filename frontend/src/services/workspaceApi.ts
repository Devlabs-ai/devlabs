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
