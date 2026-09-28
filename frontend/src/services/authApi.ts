import axios from 'axios';
import type { UserRecord } from '../types/domain';
import { readMigrating, removeMigrating, writeMigrating } from '../utils/storageMigrate';

const TOKEN_KEY = 'devsetu_jwt';
const USER_KEY = 'devsetu_user';
/** Pre-rebrand keys — read once, then remove. */
const LEGACY_TOKEN_KEY = 'devlabs_jwt';
const LEGACY_USER_KEY = 'devlabs_user';

export function getToken(): string | null {
  return readMigrating(localStorage, TOKEN_KEY, LEGACY_TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) writeMigrating(localStorage, TOKEN_KEY, LEGACY_TOKEN_KEY, token);
  else removeMigrating(localStorage, TOKEN_KEY, LEGACY_TOKEN_KEY);
}

export function clearToken(): void {
  removeMigrating(localStorage, TOKEN_KEY, LEGACY_TOKEN_KEY);
  removeMigrating(localStorage, USER_KEY, LEGACY_USER_KEY);
}

export function getAuthHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function getCurrentUser(): UserRecord | null {
  try {
    const raw = readMigrating(localStorage, USER_KEY, LEGACY_USER_KEY);
    return raw ? (JSON.parse(raw) as UserRecord) : null;
  } catch (_e) {
    return null;
  }
}

function saveUser(user: UserRecord): void {
  if (user) writeMigrating(localStorage, USER_KEY, LEGACY_USER_KEY, JSON.stringify(user));
}

export type SignupResult =
  | { pending: true; message: string; user: UserRecord }
  | { pending?: false; token: string; user: UserRecord };

export async function signup(
  email: string,
  password: string,
): Promise<SignupResult> {
  const { data, status } = await axios.post('/api/auth/signup', { email, password });
  const res = data as SignupResult;
  if (status === 202 || (res as { pending?: boolean }).pending) {
    return {
      pending: true,
      message: (res as { message?: string }).message || 'Awaiting admin approval.',
      user: (res as { user: UserRecord }).user,
    };
  }
  const authed = res as { token: string; user: UserRecord };
  setToken(authed.token);
  saveUser(authed.user);
  return authed;
}

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: UserRecord }> {
  const { data } = await axios.post('/api/auth/login', { email, password });
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

export function isAdminUser(user: UserRecord | null | undefined): boolean {
  return Boolean(user?.admin) || user?.role === 'admin';
}

export function getUserRole(user: UserRecord | null | undefined): 'admin' | 'reviewer' | 'learner' {
  if (!user) return 'learner';
  if (user.admin || user.role === 'admin') return 'admin';
  if (user.role === 'reviewer') return 'reviewer';
  return 'learner';
}

export function isReviewStaff(user: UserRecord | null | undefined): boolean {
  const role = getUserRole(user);
  return role === 'admin' || role === 'reviewer';
}

export function logout(): void {
  clearToken();
}

/** Apply JWT + user from Google OAuth redirect query params. */
export function acceptAuthSession(token: string, user: UserRecord): void {
  setToken(token);
  saveUser(user);
}

export function startGoogleSignIn(): void {
  window.location.assign('/api/auth/google');
}

export async function fetchGoogleAuthStatus(): Promise<boolean> {
  try {
    const { data } = await axios.get('/api/auth/google/status');
    return Boolean((data as { enabled?: boolean }).enabled);
  } catch {
    return false;
  }
}

