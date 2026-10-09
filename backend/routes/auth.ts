'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { signUserToken } = require('../auth/jwt');
const { requireInterviewer, resolveAdminFlag } = require('../auth/middleware');
const {
  hashPassword,
  verifyPassword,
  findUserByEmail,
  findUserByGoogleSub,
  findUserById,
  createUser,
  linkGoogleAccount,
  updateUserAuth,
  updateLastLogin,
  setUserStatus,
} = require('../auth/companyStore');
const { getRegistrationOpen } = require('../admin/settings');
const {
  googleConfigured,
  appOrigin,
  createOAuthState,
  verifyOAuthState,
  buildAuthorizeUrl,
  exchangeCodeForProfile,
} = require('../auth/googleOAuth');

const router = express.Router();

const MIN_PASSWORD_LENGTH = 8;

function publicUser(user: {
  id: string;
  email: string;
  name?: string | null;
  status?: string;
  role?: string;
  reviewTracks?: string[];
  isAdmin?: boolean;
}) {
  const admin = resolveAdminFlag(user) || user.role === 'admin';
  const role = admin ? 'admin' : (user.role || 'learner');
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    status: user.status,
    role,
    reviewTracks: role === 'reviewer' ? (user.reviewTracks || []) : [],
    admin,
  };
}

function issueAuthResponse(user: {
  id: string;
  email: string;
  name?: string | null;
  status?: string;
  role?: string;
  reviewTracks?: string[];
  isAdmin?: boolean;
}) {
  const publicProfile = publicUser(user);
  const token = signUserToken({
    userId: user.id,
    email: user.email,
    admin: publicProfile.admin,
    role: publicProfile.role,
    reviewTracks: publicProfile.reviewTracks,
  });
  return { token, user: publicProfile };
}

function normalizeEmail(raw: unknown): string {
  return String(raw || '').toLowerCase().trim();
}

function redirectToApp(res: ExpressResponse, query: Record<string, string>): void {
  const url = new URL('/auth/google/callback', `${appOrigin()}/`);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  res.redirect(302, url.toString());
}

router.post('/signup', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const email = normalizeEmail((req.body as Record<string, unknown>)?.email);
    const password = String((req.body as Record<string, unknown>)?.password || '');

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
    }

    const registrationOpen = await getRegistrationOpen();
    const targetStatus = registrationOpen ? 'active' : 'pending';
    const passwordHash = await hashPassword(password);
    const existing = await findUserByEmail(email);

    if (existing) {
      if (existing.status === 'active') {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }
      // pending or rejected: refresh credentials and re-queue (or activate if open)
      const user = await updateUserAuth({
        userId: existing.id,
        passwordHash,
        status: targetStatus,
      });
      if (user.status === 'active') {
        await updateLastLogin(user.id);
        return res.json(issueAuthResponse(user));
      }
      return res.status(202).json({
        pending: true,
        message: 'Account created. Awaiting admin approval.',
        user: publicUser(user),
      });
    }

    const user = await createUser({
      email,
      passwordHash,
      status: targetStatus,
    });

    if (user.status === 'active') {
      await updateLastLogin(user.id);
      return res.status(201).json(issueAuthResponse(user));
    }

    return res.status(202).json({
      pending: true,
      message: 'Account created. Awaiting admin approval.',
      user: publicUser(user),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/login', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const email = normalizeEmail((req.body as Record<string, unknown>)?.email);
    const password = String((req.body as Record<string, unknown>)?.password || '');

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.passwordHash) {
      return res.status(401).json({
        error: 'This account uses Google sign-in. Use Continue with Google.',
      });
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is awaiting admin approval' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ error: 'Your account registration was rejected' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    await updateLastLogin(user.id);
    res.json(issueAuthResponse(user));
  } catch (e) {
    next(e);
  }
});

/** Whether Google OAuth env is configured (for UI). */
router.get('/google/status', (_req: ExpressRequest, res: ExpressResponse) => {
  res.json({ enabled: googleConfigured() });
});

/** Start Google OAuth — browser redirect. */
router.get('/google', (_req: ExpressRequest, res: ExpressResponse) => {
  if (!googleConfigured()) {
    return res.status(503).json({
      error: 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.',
    });
  }
  const state = createOAuthState();
  res.redirect(302, buildAuthorizeUrl(state));
});

/** Google OAuth callback — exchange code, upsert user, redirect to SPA. */
router.get('/google/callback', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    if (!googleConfigured()) {
      return redirectToApp(res, { error: 'Google sign-in is not configured' });
    }

    const q = req.query as Record<string, string | undefined>;
    if (q.error) {
      return redirectToApp(res, {
        error: q.error_description || q.error || 'Google sign-in was cancelled',
      });
    }

    const code = String(q.code || '');
    const state = String(q.state || '');
    if (!code || !state || !verifyOAuthState(state)) {
      return redirectToApp(res, { error: 'Invalid or expired Google sign-in. Try again.' });
    }

    const profile = await exchangeCodeForProfile(code);
    if (!profile.emailVerified) {
      return redirectToApp(res, { error: 'Google email is not verified' });
    }

    let user = await findUserByGoogleSub(profile.sub);
    if (!user) {
      const byEmail = await findUserByEmail(profile.email);
      if (byEmail) {
        user = await linkGoogleAccount({
          userId: byEmail.id,
          googleSub: profile.sub,
          name: profile.name,
        });
        user = (await findUserByEmail(profile.email)) || user;
      } else {
        const registrationOpen = await getRegistrationOpen();
        const targetStatus = registrationOpen ? 'active' : 'pending';
        user = await createUser({
          email: profile.email,
          passwordHash: null,
          status: targetStatus,
          name: profile.name,
          googleSub: profile.sub,
        });
      }
    }

    // If signups are open, promote a previously pending Google account on next login.
    if (user.status === 'pending' && (await getRegistrationOpen())) {
      user = (await setUserStatus(user.id, 'active')) || user;
    }

    if (user.status === 'pending') {
      return redirectToApp(res, {
        pending: '1',
        message: 'Account created. Awaiting admin approval.',
      });
    }
    if (user.status === 'rejected') {
      return redirectToApp(res, { error: 'Your account registration was rejected' });
    }
    if (user.status !== 'active') {
      return redirectToApp(res, { error: 'Account is not active' });
    }

    await updateLastLogin(user.id);
    const { token, user: pub } = issueAuthResponse(user);
    return redirectToApp(res, {
      token,
      user: JSON.stringify(pub),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Google sign-in failed';
    return redirectToApp(res, { error: msg });
  }
});

router.get('/me', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const user = await findUserById(req.user!.sub || req.user!.userId || '');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }
    res.json({ user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
