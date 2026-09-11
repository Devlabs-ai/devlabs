import axios from 'axios';
import type { UserRecord } from '../types/domain';

const TOKEN_KEY = 'devlabs_jwt';
const USER_KEY = 'devlabs_user';

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

export async function loginWithEmail(email: string): Promise<{ token: string; user: UserRecord }> {
  const { data } = await axios.post('/api/auth/login-email', { email });
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

export async function login(username: string, password: string): Promise<{ token: string; user?: UserRecord }> {
  const { data } = await axios.post('/api/auth/login', { username, password });
  const res = data as { token: string; user?: UserRecord };
  setToken(res.token);
  saveUser(
    res.user || { id: username, email: `${username}@local`, admin: username === 'admin' },
  );
  return res;
}

export function isAdminUser(user: UserRecord | null | undefined): boolean {
  return Boolean(user);
}

export function logout(): void {
  clearToken();
}
