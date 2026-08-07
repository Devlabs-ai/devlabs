import axios from 'axios';
import type { ChallengePublic } from '../types/domain';
import { getAuthHeader } from './authApi';

interface RawSessionPayload {
  terminalWsUrl?: string | null;
  metricsWsUrl?: string | null;
  [key: string]: unknown;
}

interface SessionStartResult extends RawSessionPayload {
  sessionId: string;
  services?: string[];
  terminalService?: string | null;
  session?: RawSession | null;
  challenge?: ChallengePublic | null;
}

interface RawSession {
  id: string;
  startTime: number;
  status: string;
  portMap: Record<string, string | number> | null;
  services: string[];
  terminalService: string | null;
  challenge?: ChallengePublic | null;
  recovered?: boolean;
  [key: string]: unknown;
}

export interface RestoredSession {
  sessionId: string;
  status: string;
  services: string[];
  terminalService: string | null;
  portMap: Record<string, string | number> | null;
  startTime: number;
  challenge: ChallengePublic | null;
  terminalWsUrl: string;
  metricsWsUrl: string;
  session: RawSession;
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

function normalize(payload: RawSessionPayload): RawSessionPayload {
  if (!payload) return payload;
  return {
    ...payload,
    terminalWsUrl: rewriteWs(payload.terminalWsUrl),
    metricsWsUrl: rewriteWs(payload.metricsWsUrl),
  };
}

export async function startSession(challengeId: string): Promise<SessionStartResult> {
  const headers = getAuthHeader();
  const body: Record<string, string> = { challengeId };
  const { data } = await axios.post('/api/session/start', body, { headers });
  return normalize(data as RawSessionPayload) as SessionStartResult;
}

export async function getSession(id: string): Promise<RawSession | null> {
  const { data } = await axios.get(`/api/session/${id}`);
  return (data as { session: RawSession | null }).session;
}

export async function restoreSession(id: string): Promise<RestoredSession | null> {
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

export async function endSession(id: string): Promise<unknown> {
  const { data } = await axios.post(`/api/session/${id}/end`);
  return data;
}
