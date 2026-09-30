'use strict';

/**
 * Google OAuth (authorization-code) helpers.
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
 * Optional: PUBLIC_APP_ORIGIN (where the SPA lives after callback).
 */

const jwt = require('jsonwebtoken');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'devlabs-dev-secret';
}

function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim()
    && process.env.GOOGLE_CLIENT_SECRET?.trim()
    && process.env.GOOGLE_REDIRECT_URI?.trim(),
  );
}

function appOrigin(): string {
  const explicit = (process.env.PUBLIC_APP_ORIGIN || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  const host = (process.env.PUBLIC_HOST || '').trim().replace(/\/$/, '');
  if (host) {
    if (host.startsWith('http://') || host.startsWith('https://')) return host;
    return `https://${host}`;
  }
  return 'http://localhost:5173';
}

function createOAuthState(): string {
  return jwt.sign(
    { purpose: 'google_oauth', n: Math.random().toString(36).slice(2) },
    getJwtSecret(),
    { expiresIn: '10m' },
  );
}

function verifyOAuthState(state: string): boolean {
  try {
    const payload = jwt.verify(state, getJwtSecret()) as { purpose?: string };
    return payload.purpose === 'google_oauth';
  } catch {
    return false;
  }
}

function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!.trim(),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: 'select_account',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!.trim(),
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenJson.access_token) {
    const detail = tokenJson.error_description || tokenJson.error || `HTTP ${tokenRes.status}`;
    throw new Error(`Google token exchange failed: ${detail}`);
  }

  const infoRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const info = (await infoRes.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    error?: string;
  };
  if (!infoRes.ok || !info.sub || !info.email) {
    throw new Error(info.error || 'Failed to load Google profile');
  }

  const emailVerified = info.email_verified === true || info.email_verified === 'true';
  return {
    sub: info.sub,
    email: String(info.email).toLowerCase().trim(),
    emailVerified,
    name: info.name ? String(info.name) : null,
  };
}

module.exports = {
  googleConfigured,
  appOrigin,
  createOAuthState,
  verifyOAuthState,
  buildAuthorizeUrl,
  exchangeCodeForProfile,
};
