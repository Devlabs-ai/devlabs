import axios from 'axios';

const TOKEN_KEY = 'devlabs_jwt';
const USER_KEY  = 'devlabs_user';

// ---------------------------------------------------------------------------
// Token / user helpers
// ---------------------------------------------------------------------------

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getAuthHeader() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function getCurrentUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_e) {
    return null;
  }
}

function saveUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// ---------------------------------------------------------------------------
// OTP login (new primary flow)
// ---------------------------------------------------------------------------

// Step 1 — request OTP for an email address
export async function requestOtp(email) {
  const { data } = await axios.post('/api/auth/request-otp', { email });
  return data;
}

// Step 2 — verify the 6-digit code; persists token + user on success
export async function verifyOtp(email, code) {
  const { data } = await axios.post('/api/auth/verify-otp', { email, code });
  setToken(data.token);
  saveUser(data.user);
  return data;
}

// Refresh user info from the server (e.g. after a role change)
export async function fetchMe() {
  const { data } = await axios.get('/api/auth/me', { headers: getAuthHeader() });
  if (data.user) saveUser(data.user);
  return data;
}

// ---------------------------------------------------------------------------
// Legacy username/password login — kept during migration
// ---------------------------------------------------------------------------

export async function login(username, password) {
  const { data } = await axios.post('/api/auth/login', { username, password });
  setToken(data.token);
  saveUser({ role: data.role || 'interviewer' });
  return data;
}

export function logout() {
  clearToken();
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export async function createInvite({ challengeId, name } = {}) {
  const { data } = await axios.post(
    '/api/auth/invites',
    { challengeId, name },
    { headers: getAuthHeader() },
  );
  return data.invite;
}

export async function fetchInvites() {
  const { data } = await axios.get('/api/auth/invites', { headers: getAuthHeader() });
  return data.invites;
}

export async function resolveInvite(token) {
  const { data } = await axios.get(`/api/auth/invite/${token}`);
  return data;
}
