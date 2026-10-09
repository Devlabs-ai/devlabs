'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const pool = require('../db/pool');
const { requireAdmin } = require('../auth/middleware');
const { sendWaitlistConfirmation } = require('../services/emailService');

const router = express.Router();

const ROLES = new Set(['student', 'developer']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const recentByIp = new Map<string, number[]>();

function clientIp(req: ExpressRequest): string {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (recentByIp.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recentByIp.set(ip, hits);
  if (recentByIp.size > 10_000) {
    for (const [key, times] of recentByIp) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) recentByIp.delete(key);
    }
  }
  return hits.length > RATE_MAX;
}

// POST /api/waitlist — public, no account needed.
router.post('/', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const body = (req.body as Record<string, unknown>) || {};

    // Hidden form field; real visitors leave it empty.
    if (String(body.website || '').trim()) {
      res.json({ ok: true });
      return;
    }

    if (rateLimited(clientIp(req))) {
      res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
      return;
    }

    const email = String(body.email || '').toLowerCase().trim();
    const role = String(body.role || '').toLowerCase().trim();
    const organization = String(body.organization || '').trim().slice(0, 120) || null;
    const source = String(body.source || '').trim().slice(0, 60) || null;

    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'Enter a valid email address' });
      return;
    }
    if (!ROLES.has(role)) {
      res.status(400).json({ error: 'Tell us whether you are a student or a developer' });
      return;
    }

    const { rows } = await pool.query(
      `INSERT INTO waitlist_signups (email, role, organization, source, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
         SET role = EXCLUDED.role,
             organization = COALESCE(EXCLUDED.organization, waitlist_signups.organization)
       RETURNING (xmax = 0) AS inserted`,
      [email, role, organization, source, Date.now()],
    );

    if (rows[0]?.inserted) {
      sendWaitlistConfirmation(email).catch((e: Error) => {
        console.warn('[waitlist] confirmation email failed:', e.message);
      });
    }

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/waitlist — admin only.
router.get('/', requireAdmin, async (_req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT email, role, organization, source, created_at
         FROM waitlist_signups
        ORDER BY created_at DESC`,
    );
    res.json({
      signups: rows.map((r: Record<string, unknown>) => ({
        email: String(r.email),
        role: String(r.role),
        organization: (r.organization as string | null) || null,
        source: (r.source as string | null) || null,
        createdAt: Number(r.created_at) || 0,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/waitlist/:email — admin only (test or spam entries).
router.delete('/:email', requireAdmin, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const email = String(req.params.email || '').toLowerCase().trim();
    const { rowCount } = await pool.query('DELETE FROM waitlist_signups WHERE email = $1', [email]);
    if (!rowCount) {
      res.status(404).json({ error: 'Sign-up not found' });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
