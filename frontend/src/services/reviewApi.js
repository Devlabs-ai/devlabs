import axios from 'axios';
import { getAuthHeader } from './authApi.js';

function rewriteWs(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    return `${u.protocol}//${window.location.host}${u.pathname}${u.search}`;
  } catch (_e) {
    return url;
  }
}

function normalizePreview(payload) {
  if (!payload) return payload;
  return {
    ...payload,
    terminalWsUrl: rewriteWs(payload.terminalWsUrl),
    metricsWsUrl: rewriteWs(payload.metricsWsUrl),
  };
}

export async function listReviews() {
  const { data } = await axios.get('/api/reviews', { headers: getAuthHeader() });
  return data.reviews;
}

export async function getReview(sessionId) {
  const { data } = await axios.get(`/api/reviews/${sessionId}`, { headers: getAuthHeader() });
  return data.review;
}

export async function pushReview(sessionId, { bucket } = {}) {
  const { data } = await axios.post(
    `/api/reviews/${sessionId}/push`,
    { bucket },
    { headers: getAuthHeader() },
  );
  return data;
}

export async function dismissReview(sessionId) {
  const { data } = await axios.delete(`/api/reviews/${sessionId}`, { headers: getAuthHeader() });
  return data;
}

export async function sendBackReview(sessionId, { observations, tags = [], severity = 'blocker' } = {}) {
  const { data } = await axios.post(
    `/api/reviews/${sessionId}/send-back`,
    { observations, tags, severity },
    { headers: getAuthHeader() },
  );
  return data;
}

export async function startReviewPreview(sessionId) {
  const { data } = await axios.post(
    `/api/reviews/${sessionId}/preview`,
    {},
    { headers: getAuthHeader() },
  );
  return normalizePreview(data);
}

export async function endReviewPreview(sessionId) {
  const { data } = await axios.post(
    `/api/reviews/${sessionId}/preview/end`,
    {},
    { headers: getAuthHeader() },
  );
  return data;
}
