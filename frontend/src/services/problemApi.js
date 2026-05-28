import axios from 'axios';
import { getAuthHeader } from './authApi.js';

export async function getProblemConfig() {
  const { data } = await axios.get('/api/problems/config', { headers: getAuthHeader() });
  return data;
}

export async function listProblemSessions() {
  const { data } = await axios.get('/api/problems', { headers: getAuthHeader() });
  return data.drafts;
}

export async function createProblemSession() {
  const { data } = await axios.post('/api/problems/session', {}, { headers: getAuthHeader() });
  return data;
}

export async function importDraft(draft) {
  const { data } = await axios.post(
    '/api/problems/import-draft',
    { draft },
    { headers: getAuthHeader() },
  );
  return data;
}

export async function getProblemSession(sessionId) {
  const { data } = await axios.get(`/api/problems/${sessionId}`, { headers: getAuthHeader() });
  return data.draft;
}

export async function deleteProblemSession(sessionId) {
  const { data } = await axios.delete(`/api/problems/${sessionId}`, { headers: getAuthHeader() });
  return data;
}

export async function cancelBuild(sessionId) {
  const { data } = await axios.post(
    `/api/problems/${sessionId}/cancel-build`,
    {},
    { headers: getAuthHeader() },
  );
  return data;
}

export async function updateDraftMeta(sessionId, patch) {
  const { data } = await axios.patch(
    `/api/problems/${sessionId}/meta`,
    patch,
    { headers: getAuthHeader() },
  );
  return data.draft;
}

export async function pushToSandbox(sessionId) {
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

async function streamSse({ url, body, onEvent, signal }) {
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
    let idx;
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

export function streamChat(sessionId, message, onEvent, { signal } = {}) {
  return streamSse({
    url: `/api/problems/${sessionId}/chat`,
    body: { message },
    onEvent,
    signal,
  });
}

export async function approveDesign(sessionId) {
  const { data } = await axios.post(
    `/api/problems/${sessionId}/approve-design`,
    {},
    { headers: getAuthHeader() },
  );
  return data;
}

export async function reviseDesign(sessionId) {
  const { data } = await axios.post(
    `/api/problems/${sessionId}/revise-design`,
    {},
    { headers: getAuthHeader() },
  );
  return data;
}

export function generateSchema(sessionId, onEvent, { signal } = {}) {
  return streamSse({
    url: `/api/problems/${sessionId}/generate-schema`,
    body: {},
    onEvent,
    signal,
  });
}

export function streamBuild(sessionId, onEvent, { signal } = {}) {
  return streamSse({
    url: `/api/problems/${sessionId}/build`,
    body: {},
    onEvent,
    signal,
  });
}
