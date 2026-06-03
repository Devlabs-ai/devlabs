'use strict';

const express = require('express');
const { sendSalesLead } = require('../services/emailService');

const router = express.Router();

const TEAM_SIZES = new Set(['1-10', '11-50', '51-200', '200+']);
const PLANS = new Set(['starter', 'pro', 'enterprise', 'unsure']);

// POST /api/contact/sales
router.post('/sales', async (req, res, next) => {
  try {
    const companyName = String(req.body?.companyName || '').trim();
    const email = String(req.body?.email || '').toLowerCase().trim();
    const teamSize = String(req.body?.teamSize || '').trim();
    const plan = String(req.body?.plan || 'unsure').trim().toLowerCase();
    const message = String(req.body?.message || '').trim();

    if (!companyName) {
      return res.status(400).json({ error: 'Company name is required' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid work email is required' });
    }
    if (!TEAM_SIZES.has(teamSize)) {
      return res.status(400).json({ error: 'Select a team size' });
    }
    if (!PLANS.has(plan)) {
      return res.status(400).json({ error: 'Select a plan' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message must be 2000 characters or fewer' });
    }

    const domain = email.split('@')[1] || '';

    await sendSalesLead({
      companyName,
      email,
      domain,
      teamSize,
      plan,
      message,
    });

    res.json({ ok: true, message: 'Thanks — our team will reach out shortly.' });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
