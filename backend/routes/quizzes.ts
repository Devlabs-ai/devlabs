'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { requireInterviewer } = require('../auth/middleware');
const { listQuizzesFromMinio, loadQuizFromMinio } = require('../challenges/minioQuizAssets');

const router = express.Router();

/** List quizzes published under quizzes/<id>/quiz.json. */
router.get('/', requireInterviewer, async (_req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const quizzes = await listQuizzesFromMinio();
    res.json({ quizzes });
  } catch (e) {
    next(e);
  }
});

/** Full quiz payload (questions + exhibit code) — MinIO only. */
router.get('/:id', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const quiz = await loadQuizFromMinio(req.params.id);
    res.json({ quiz });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
