import axios from 'axios';
import { getAuthHeader } from './authApi';

type LeaseGlobals = {
  __devlabsLabClientId?: string;
  __devlabsLabInterceptors?: { request: number; response: number };
};
const leaseGlobals: LeaseGlobals = typeof window !== 'undefined' ? (window as LeaseGlobals) : {};

/**
 * Per page-load id (not sessionStorage: a duplicated tab copies sessionStorage,
 * which would let two tabs share one lease). Reloads release via sendBeacon.
 * Kept on window so a hot module reload does not give the same tab a second id.
 */
const CLIENT_ID: string = leaseGlobals.__devlabsLabClientId
  || (leaseGlobals.__devlabsLabClientId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const LAB_HEARTBEAT_MS = 15_000;

/** Fired when the backend rejects this tab because another tab now holds the lab. */
export const LAB_LEASE_TAKEN_EVENT = 'devlabs:lab-lease-taken';
/** Fired when this tab learns its lab session was ended elsewhere. */
export const LAB_SESSION_ENDED_EVENT = 'devlabs:lab-session-ended';
/** Fired after this tab takes the lab back, so the workspace can reconnect its terminal. */
export const LAB_LEASE_RECLAIMED_EVENT = 'devlabs:lab-lease-reclaimed';

const SESSION_API = /^\/api\/session\//;
const LEASE_EXEMPT = /\/(start|heartbeat|lease\/release)$/;

if (leaseGlobals.__devlabsLabInterceptors) {
  axios.interceptors.request.eject(leaseGlobals.__devlabsLabInterceptors.request);
  axios.interceptors.response.eject(leaseGlobals.__devlabsLabInterceptors.response);
}

// Lets the backend refuse lab changes from a tab that no longer holds the lab.
const requestInterceptor = axios.interceptors.request.use((config) => {
  if (config.url && SESSION_API.test(config.url)) {
    config.headers.set('X-Lab-Client', CLIENT_ID);
  }
  return config;
});

const responseInterceptor = axios.interceptors.response.use(undefined, (error) => {
  const url: string = error?.config?.url || '';
  if (
    error?.response?.status === 409
    && error.response.data?.code === 'LAB_OPEN_IN_OTHER_TAB'
    && SESSION_API.test(url)
    && !LEASE_EXEMPT.test(url)
    && typeof window !== 'undefined'
  ) {
    window.dispatchEvent(new Event(LAB_LEASE_TAKEN_EVENT));
  }
  return Promise.reject(error);
});

leaseGlobals.__devlabsLabInterceptors = { request: requestInterceptor, response: responseInterceptor };

export type LabConflictCode = 'ACTIVE_LAB_ELSEWHERE' | 'LAB_OPEN_IN_OTHER_TAB';

export interface LabConflict {
  code: LabConflictCode;
  message: string;
  activeTitle: string | null;
}

export function labClientId(): string {
  return CLIENT_ID;
}

export function withLabClientId(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}clientId=${encodeURIComponent(CLIENT_ID)}`;
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
