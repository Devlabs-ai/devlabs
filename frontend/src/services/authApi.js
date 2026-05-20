import axios from 'axios';

const TOKEN_KEY = 'devlabs_jwt';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getAuthHeader() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function login(username, password) {
  const { data } = await axios.post('/api/auth/login', { username, password });
  setToken(data.token);
  return data;
}

export function logout() {
  clearToken();
}

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
