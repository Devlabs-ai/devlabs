'use strict';

const express = require('express');
const { signInterviewerToken } = require('../auth/jwt');
const { requireInterviewer } = require('../auth/middleware');
const invites = require('../auth/invites');

const router = express.Router();

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const token = signInterviewerToken(username);
  res.json({ token, role: 'interviewer' });
});

router.post('/invites', requireInterviewer, async (req, res, next) => {
  try {
    const { challengeId, name } = req.body || {};
    const invite = await invites.createInvite({ challengeId, name });
    res.status(201).json({ invite });
  } catch (e) {
    next(e);
  }
});

router.get('/invites', requireInterviewer, async (_req, res, next) => {
  try {
    const list = await invites.listInvites();
    res.json({ invites: list });
  } catch (e) {
    next(e);
  }
});

router.get('/invite/:token', async (req, res, next) => {
  try {
    const invite = await invites.resolveInvite(req.params.token);
    if (!invite) return res.status(404).json({ error: 'invite not found' });
    res.json({
      name: invite.name,
      challengeId: invite.challengeId,
      used: invite.used,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
