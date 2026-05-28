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

function normalize(payload) {
  if (!payload) return payload;
  return {
    ...payload,
    terminalWsUrl: rewriteWs(payload.terminalWsUrl),
    metricsWsUrl: rewriteWs(payload.metricsWsUrl),
    agentObserverWsUrl: rewriteWs(payload.agentObserverWsUrl),
  };
}

export async function startSession(challengeId, candidateToken = null) {
  const headers = candidateToken ? {} : getAuthHeader();
  const body = { challengeId };
  if (candidateToken) body.candidateToken = candidateToken;
  const { data } = await axios.post('/api/session/start', body, { headers });
  return normalize(data);
}

export async function getSession(id) {
  const { data } = await axios.get(`/api/session/${id}`);
  return data.session;
}

export async function restoreSession(id) {
  const session = await getSession(id);
  if (!session) return null;
  const base = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
  return {
    sessionId: session.id,
    status: session.status,
    services: session.services || [],
    terminalService: session.terminalService || null,
    portMap: session.portMap || null,
    startTime: session.startTime,
    challenge: session.challenge || null,
    terminalWsUrl: `${base}/ws/terminal?sessionId=${id}`,
    metricsWsUrl: `${base}/ws/metrics?sessionId=${id}`,
    session,
  };
}

export async function endSession(id) {
  const { data } = await axios.post(`/api/session/${id}/end`);
  return data;
}
