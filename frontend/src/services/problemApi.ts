import axios from 'axios';
import { getAuthHeader } from './authApi';

interface SseOptions {
  url: string;
  body?: Record<string, unknown>;
  onEvent: (event: unknown) => void;
  signal?: AbortSignal;
}

interface DraftMeta {
  [key: string]: unknown;
}

export async function getProblemConfig(): Promise<unknown> {
  const { data } = await axios.get('/api/problems/config', { headers: getAuthHeader() });
  return data;
}

export async function listProblemSessions(): Promise<unknown[]> {
  const { data } = await axios.get('/api/problems', { headers: getAuthHeader() });
  return (data as { drafts: unknown[] }).drafts;
}

export async function createProblemSession(): Promise<unknown> {
  const { data } = await axios.post('/api/problems/session', {}, { headers: getAuthHeader() });
  return data;
}

export async function importDraft(draft: unknown): Promise<unknown> {
  const { data } = await axios.post(
    '/api/problems/import-draft',
    { draft },
    { headers: getAuthHeader() },
  );
  return data;
}

export async function getProblemSession(sessionId: string): Promise<unknown> {
  const { data } = await axios.get(`/api/problems/${sessionId}`, { headers: getAuthHeader() });
  return (data as { draft: unknown }).draft;
}

export async function deleteProblemSession(sessionId: string): Promise<unknown> {
  const { data } = await axios.delete(`/api/problems/${sessionId}`, { headers: getAuthHeader() });
  return data;
}

export async function cancelBuild(sessionId: string): Promise<unknown> {
  const { data } = await axios.post(
    `/api/problems/${sessionId}/cancel-build`,
    {},
    { headers: getAuthHeader() },
  );
  return data;
}

export async function updateDraftMeta(sessionId: string, patch: DraftMeta): Promise<unknown> {
  const { data } = await axios.patch(
    `/api/problems/${sessionId}/meta`,
    patch,
    { headers: getAuthHeader() },
  );
  return (data as { draft: unknown }).draft;
}

export async function pushToSandbox(sessionId: string): Promise<unknown> {
  const { data } = await axios.post(
    `/api/problems/${sessionId}/push-to-sandbox`,
    {},
    { headers: getAuthHeader() },
  );
  return data;
}

// --- SSE helpers ---------------------------------------------------------
//
// fetch() lets us POST with an auth header and read a streamed response body.
// We parse SSE frames manually: each event is a chunk of lines ending with
// a blank line; `data: <json>` carries the payload.

async function streamSse({ url, body, onEvent, signal }: SseOptions): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: JSON.stringify(body || {}),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    // SSE event delimiter is a blank line (\n\n)
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLines = rawEvent
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      const dataStr = dataLines.join('\n');
      try {
        onEvent(JSON.parse(dataStr));
      } catch (_e) { /* ignore non-JSON frames (e.g. ":sse-connected") */ }
    }
  }
}

export function streamChat(
  sessionId: string,
  message: string,
  onEvent: (event: unknown) => void,
  { signal }: { signal?: AbortSignal } = {},
): Promise<void> {
  return streamSse({
    url: `/api/problems/${sessionId}/chat`,
    body: { message },
    onEvent,
    signal,
  });
}

export async function approveDesign(sessionId: string): Promise<unknown> {
  const { data } = await axios.post(
    `/api/problems/${sessionId}/approve-design`,
    {},
    { headers: getAuthHeader() },
  );
  return data;
}

/** Upload / apply a Spark shape contract JSON (Preview path; does not auto-approve). */
export async function uploadSparkShape(
  sessionId: string,
  contract: unknown,
): Promise<unknown> {
  const { data } = await axios.post(
    `/api/problems/${sessionId}/spark-shape`,
    { contract },
    { headers: getAuthHeader() },
  );
  return data;
}

export async function reviseDesign(sessionId: string): Promise<unknown> {
  const { data } = await axios.post(
    `/api/problems/${sessionId}/revise-design`,
    {},
    { headers: getAuthHeader() },
  );
  return data;
}

export function generateSchema(
  sessionId: string,
  onEvent: (event: unknown) => void,
  { signal }: { signal?: AbortSignal } = {},
): Promise<void> {
  return streamSse({
    url: `/api/problems/${sessionId}/generate-schema`,
    body: {},
    onEvent,
    signal,
  });
}

export function streamBuild(
  sessionId: string,
  onEvent: (event: unknown) => void,
  { signal, mode }: { signal?: AbortSignal; mode?: 'retry' | 'fresh' } = {},
): Promise<void> {
  return streamSse({
    url: `/api/problems/${sessionId}/build`,
    body: mode ? { mode } : {},
    onEvent,
    signal,
  });
}
