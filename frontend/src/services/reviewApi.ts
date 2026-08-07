import axios from 'axios';
import { getAuthHeader } from './authApi';

interface RawPreviewPayload {
  terminalWsUrl?: string | null;
  metricsWsUrl?: string | null;
  [key: string]: unknown;
}

function rewriteWs(url: string | null | undefined): string | null | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    return `${u.protocol}//${window.location.host}${u.pathname}${u.search}`;
  } catch (_e) {
    return url;
  }
}

function normalizePreview(payload: RawPreviewPayload | null): RawPreviewPayload | null {
  if (!payload) return payload;
  return {
    ...payload,
    terminalWsUrl: rewriteWs(payload.terminalWsUrl),
    metricsWsUrl: rewriteWs(payload.metricsWsUrl),
  };
}

export async function listReviews(): Promise<unknown[]> {
  const { data } = await axios.get('/api/reviews', { headers: getAuthHeader() });
  return (data as { reviews: unknown[] }).reviews;
}

export async function getReview(sessionId: string): Promise<unknown> {
  const { data } = await axios.get(`/api/reviews/${sessionId}`, { headers: getAuthHeader() });
  return (data as { review: unknown }).review;
}

export async function pushReview(sessionId: string): Promise<unknown> {
  const { data } = await axios.post(`/api/reviews/${sessionId}/push`, {}, {
    headers: getAuthHeader(),
  });
  return data;
}

export async function dismissReview(sessionId: string): Promise<unknown> {
  const { data } = await axios.delete(`/api/reviews/${sessionId}`, { headers: getAuthHeader() });
  return data;
}

export async function sendBackReview(
  sessionId: string,
  { observations, tags = [], severity = 'blocker' }: {
    observations?: string;
    tags?: string[];
    severity?: string;
  } = {},
): Promise<unknown> {
  const { data } = await axios.post(
    `/api/reviews/${sessionId}/send-back`,
    { observations, tags, severity },
    { headers: getAuthHeader() },
  );
  return data;
}

export async function startReviewPreview(sessionId: string): Promise<RawPreviewPayload | null> {
  const { data } = await axios.post(
    `/api/reviews/${sessionId}/preview`,
    {},
    { headers: getAuthHeader() },
  );
  return normalizePreview(data as RawPreviewPayload);
}

export async function endReviewPreview(sessionId: string): Promise<unknown> {
  const { data } = await axios.post(
    `/api/reviews/${sessionId}/preview/end`,
    {},
    { headers: getAuthHeader() },
  );
  return data;
}
