'use strict';

const express = require('express');
const { signUserToken, signInterviewerToken } = require('../auth/jwt');
const { requireInterviewer, requireAdmin } = require('../auth/middleware');
const invites = require('../auth/invites');
const { createOtp, verifyOtp } = require('../auth/otp');
const { sendOtp } = require('../services/emailService');
const {
  findCompanyByDomain,
  checkAndDeactivate,
  upsertUser,
  updateLastLogin,
  findUserById,
  createCompany,
  createLibrary,
  getLibraryForCompany,
  getPublicLibrary,
} = require('../auth/companyStore');

const router = express.Router();

// ---------------------------------------------------------------------------
// OTP login flow
// ---------------------------------------------------------------------------

// Step 1 — send OTP
// POST /api/auth/request-otp  { email }
router.post('/request-otp', async (req, res, next) => {
  try {
    const email = (req.body?.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const domain = email.split('@')[1];
    const company = await findCompanyByDomain(domain);
    if (!company) {
      return res.status(403).json({ error: 'Your company is not registered on Devlabs' });
    }

    const checked = await checkAndDeactivate(company);
    if (!checked.is_active) {
      return res.status(403).json({ error: 'Your company subscription has expired — contact your admin' });
    }

    const code = await createOtp(email);
    await sendOtp(email, code);

    res.json({ ok: true, message: `OTP sent to ${email}` });
  } catch (e) {
    next(e);
  }
});

// Step 2 — verify OTP, issue JWT
// POST /api/auth/verify-otp  { email, code }
router.post('/verify-otp', async (req, res, next) => {
  try {
    const email = (req.body?.email || '').toLowerCase().trim();
    const code = String(req.body?.code || '').trim();

    if (!email || !code) {
      return res.status(400).json({ error: 'email and code are required' });
    }

    const result = await verifyOtp(email, code);
    if (!result.ok) {
      return res.status(401).json({ error: result.reason });
    }

    const domain = email.split('@')[1];
    const company = await findCompanyByDomain(domain);
    if (!company || !company.is_active) {
      return res.status(403).json({ error: 'Company inactive or not found' });
    }

    const user = await upsertUser({ email, companyId: company.id });
    await updateLastLogin(user.id);

    const token = signUserToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: company.id,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: company.id,
        companyName: company.name,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Company management  (admin only)
// ---------------------------------------------------------------------------

// POST /api/auth/companies  { name, domain, plan, subscriptionEnd }
router.post('/companies', requireAdmin, async (req, res, next) => {
  try {
    const { name, domain, plan, subscriptionEnd } = req.body || {};
    if (!name || !domain) return res.status(400).json({ error: 'name and domain are required' });
    const company = await createCompany({ name, domain, plan, subscriptionEnd });
    res.status(201).json({ company });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Domain already registered' });
    next(e);
  }
});

// GET /api/auth/me  — returns current user info from the JWT
router.get('/me', requireInterviewer, async (req, res, next) => {
  try {
    const user = await findUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const library = await getLibraryForCompany(req.user.companyId);
    const publicLib = await getPublicLibrary();
    res.json({ user, library, publicLibrary: publicLib });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Legacy username/password login — kept during migration, remove later
// ---------------------------------------------------------------------------

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== 'admin' || password !== 'admin123') {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const token = signInterviewerToken(username);
  res.json({ token, role: 'interviewer' });
});

// ---------------------------------------------------------------------------
// Invites (unchanged)
// ---------------------------------------------------------------------------

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
    res.json({ name: invite.name, challengeId: invite.challengeId, used: invite.used });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
