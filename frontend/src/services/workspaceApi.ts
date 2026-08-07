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
  starterFiles: SparkProjectFiles,
  entrypoint = 'src/main.py',
): Promise<SparkSessionStartResult> {
  const { data } = await axios.post(
    '/api/session/spark/start',
    { challengeId, starterFiles, entrypoint },
    { headers: getAuthHeader() },
  );
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

export interface StartSparkJobBody {
  mode: 'run' | 'submit';
  inputPath: string;
  businessDate?: string;
  /** s3a path to challenges/.../eval/solution.json */
  evalSolutionPath?: string;
  limits?: {
    driver?: number;
    executors?: number;
    executorCores?: number;
    executorMemory?: string;
  };
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

export async function fetchSparkSubmissions(sessionId: string): Promise<SparkJobRecord[]> {
  const { data } = await axios.get(`/api/session/${sessionId}/spark/submissions`, {
    headers: getAuthHeader(),
  });
  return (data.submissions || []) as SparkJobRecord[];
}
