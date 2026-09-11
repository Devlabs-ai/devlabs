'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { requireAdmin, isAdminUser } = require('../auth/middleware');
const {
  readAdminSettings,
  setSparkJobWatcherEnabled,
} = require('../admin/settings');

const router = express.Router();

router.get(
  '/settings',
  requireAdmin,
  async (_req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      res.json(await readAdminSettings());
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/settings',
  requireAdmin,
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const body = (req.body || {}) as { sparkJobWatcherEnabled?: unknown };
      if (typeof body.sparkJobWatcherEnabled !== 'boolean') {
        res.status(400).json({ error: 'sparkJobWatcherEnabled must be a boolean' });
        return;
      }
      res.json(await setSparkJobWatcherEnabled(body.sparkJobWatcherEnabled));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * Re-seed packs → Postgres and refresh the in-memory challenge cache.
 * Auth: admin JWT, or header X-DevLabs-Reload-Token matching CHALLENGE_RELOAD_TOKEN.
 */
router.post(
  '/challenges/reload',
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const expected = String(process.env.CHALLENGE_RELOAD_TOKEN || 'devlabs-reload').trim();
      const provided = String(req.headers['x-devlabs-reload-token'] || '').trim();
      const tokenOk = Boolean(expected && provided && provided === expected);

      if (!tokenOk) {
        const { verifyToken } = require('../auth/jwt');
        const h = req.headers.authorization || '';
        const bearer = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
        const payload = bearer ? verifyToken(bearer) : null;
        if (!payload || !isAdminUser(payload)) {
          res.status(401).json({
            error: 'admin JWT or X-DevLabs-Reload-Token required',
          });
          return;
        }
        req.user = payload;
      }

      const { seedManualCatalog } = require('../challenges/seedManualCatalog');
      const { loadChallengesFromDB, listChallenges } = require('../challenges/loader');
      await seedManualCatalog();
      await loadChallengesFromDB();
      res.json({
        ok: true,
        count: listChallenges().length,
        reloadedAt: Date.now(),
      });
    } catch (e) {
      next(e);
    }
  },
);

module.exports = router;
