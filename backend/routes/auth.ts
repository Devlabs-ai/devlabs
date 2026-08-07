'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { signUserToken, signInterviewerToken } = require('../auth/jwt');
const { requireInterviewer } = require('../auth/middleware');
const {
  upsertUser,
  updateLastLogin,
  findUserById,
} = require('../auth/companyStore');

const router = express.Router();

// Dev login — email only.
router.post('/login-email', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const email = String((req.body as Record<string, unknown>)?.email || '')
      .toLowerCase()
      .trim();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const user = await upsertUser({ email });
    await updateLastLogin(user.id);

    const token = signUserToken({
      userId: user.id,
      email: user.email,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/me', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const user = await findUserById(req.user!.sub || req.user!.userId || '');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e) {
    next(e);
  }
});

router.post('/login', (req: ExpressRequest, res: ExpressResponse) => {
  const { username, password } = (req.body as Record<string, string>) || {};
  if (username !== 'admin' || password !== 'admin123') {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const token = signInterviewerToken(username);
  res.json({ token });
});

module.exports = router;
