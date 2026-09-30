import axios from 'axios';
import { getAuthHeader } from './authApi';

/**
 * Per page-load id (not sessionStorage: a duplicated tab copies sessionStorage,
 * which would let two tabs share one lease). Reloads release via sendBeacon.
 */
const CLIENT_ID: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const LAB_HEARTBEAT_MS = 15_000;

export type LabConflictCode = 'ACTIVE_LAB_ELSEWHERE' | 'LAB_OPEN_IN_OTHER_TAB';

export interface LabConflict {
  code: LabConflictCode;
  message: string;
  activeTitle: string | null;
}

export function labClientId(): string {
  return CLIENT_ID;
}

/** Recognise a 409 from a lab start call. */
export function labConflictFromError(e: unknown): LabConflict | null {
  const err = e as {
    response?: {
      status?: number;
      data?: { code?: string; error?: string; active?: { title?: string | null } };
    };
  };
  const data = err?.response?.data;
  if (err?.response?.status !== 409 || !data?.code) return null;
  if (data.code !== 'ACTIVE_LAB_ELSEWHERE' && data.code !== 'LAB_OPEN_IN_OTHER_TAB') return null;
  return {
    code: data.code,
    message: data.error || '',
    activeTitle: data.active?.title || null,
  };
}

export type HeartbeatResult = 'ok' | 'taken' | 'ended' | 'error';

export async function sendLabHeartbeat(sessionId: string, force = false): Promise<HeartbeatResult> {
  try {
    await axios.post(
      `/api/session/${sessionId}/heartbeat`,
      { clientId: CLIENT_ID, force },
      { headers: getAuthHeader() },
    );
    return 'ok';
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 409) return 'taken';
    if (status === 410 || status === 404) return 'ended';
    return 'error';
  }
}

export function releaseLabLease(sessionId: string): void {
  const url = `/api/session/${sessionId}/lease/release`;
  const payload = JSON.stringify({ clientId: CLIENT_ID });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      return;
    }
  } catch {
    /* fall through */
  }
  void axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } }).catch(() => {});
}
