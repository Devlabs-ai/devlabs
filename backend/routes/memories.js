'use strict';

const express = require('express');
const { requireInterviewer } = require('../auth/middleware');
const catalogueStore = require('../pipeline/catalogue/catalogueStore');
const lessonStore = require('../pipeline/stores/lessonStore');

const router = express.Router();

router.use(requireInterviewer);

function parsePageQuery(req) {
  return {
    page: req.query.page,
    limit: req.query.limit,
    category: req.query.category || null,
  };
}

router.get('/catalogue', async (req, res, next) => {
  try {
    const { page, limit, category } = parsePageQuery(req);
    const result = await catalogueStore.listPaginated({ page, limit, category });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/lessons', async (req, res, next) => {
  try {
    const { page, limit, category } = parsePageQuery(req);
    const phase = req.query.phase || null;
    if (phase && phase !== 'start' && phase !== 'validate') {
      return res.status(400).json({ error: 'phase must be start or validate' });
    }
    const result = await lessonStore.listPaginated({ page, limit, phase, category });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/stats', async (_req, res, next) => {
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
