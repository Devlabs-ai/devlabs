'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { requireAdmin } = require('../auth/middleware');
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

module.exports = router;
