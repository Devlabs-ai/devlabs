import axios from 'axios';
import type { UserRecord, InviteRecord, AuthRole } from '../types/domain';

const TOKEN_KEY = 'devlabs_jwt';
const USER_KEY  = 'devlabs_user';

// ---------------------------------------------------------------------------
// Token / user helpers
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getAuthHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function getCurrentUser(): UserRecord | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as UserRecord) : null;
  } catch (_e) {
    return null;
  }
}

function saveUser(user: UserRecord): void {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// ---------------------------------------------------------------------------
// OTP login (new primary flow)
// ---------------------------------------------------------------------------

export async function requestOtp(email: string): Promise<unknown> {
  const { data } = await axios.post('/api/auth/request-otp', { email });
  return data;
}

export async function verifyOtp(email: string, code: string): Promise<{ token: string; user: UserRecord }> {
  const { data } = await axios.post('/api/auth/verify-otp', { email, code });
  const res = data as { token: string; user: UserRecord };
  setToken(res.token);
  saveUser(res.user);
  return res;
}

export async function fetchMe(): Promise<{ user?: UserRecord }> {
  const { data } = await axios.get('/api/auth/me', { headers: getAuthHeader() });
  const res = data as { user?: UserRecord };
  if (res.user) saveUser(res.user);
  return res;
}

// ---------------------------------------------------------------------------
// Legacy username/password login — kept during migration
// ---------------------------------------------------------------------------

export async function login(username: string, password: string): Promise<{ token: string; role?: string }> {
  const { data } = await axios.post('/api/auth/login', { username, password });
  const res = data as { token: string; role?: string };
  setToken(res.token);
  saveUser({ role: (res.role || 'interviewer') as AuthRole } as UserRecord);
  return res;
}

export function logout(): void {
  clearToken();
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export async function createInvite({ challengeId, name, email }: {
  challengeId?: string;
  name?: string;
  email?: string;
} = {}): Promise<InviteRecord> {
  const { data } = await axios.post(
    '/api/auth/invites',
    { challengeId, name, email },
    { headers: getAuthHeader() },
  );
  return (data as { invite: InviteRecord }).invite;
}

export async function fetchInvites(): Promise<InviteRecord[]> {
  const { data } = await axios.get('/api/auth/invites', { headers: getAuthHeader() });
  return (data as { invites: InviteRecord[] }).invites;
}

export async function resolveInvite(token: string): Promise<InviteRecord> {
  const { data } = await axios.get(`/api/auth/invite/${token}`);
  return data as InviteRecord;
}
