'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { requireInterviewer } = require('../auth/middleware');
const catalogueStore = require('../pipeline/catalogue/catalogueStore');
const lessonStore = require('../pipeline/stores/lessonStore');

const router = express.Router();

router.use(requireInterviewer);

function parsePageQuery(req: ExpressRequest): { page: unknown; limit: unknown; category: string | null } {
  return {
    page: req.query.page,
    limit: req.query.limit,
    category: (req.query.category as string) || null,
  };
}

router.get('/catalogue', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const { page, limit, category } = parsePageQuery(req);
    const result = await catalogueStore.listPaginated({ page, limit, category });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/lessons', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const { page, limit, category } = parsePageQuery(req);
    const phase = (req.query.phase as string) || null;
    if (phase && phase !== 'spin' && phase !== 'validate') {
      return res.status(400).json({ error: 'phase must be spin or validate' });
    }
    const result = await lessonStore.listPaginated({ page, limit, phase, category });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/stats', async (_req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const [catalogue, lessons] = await Promise.all([
      catalogueStore.count(),
      lessonStore.count(),
    ]);
    res.json({ catalogue, lessons });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
