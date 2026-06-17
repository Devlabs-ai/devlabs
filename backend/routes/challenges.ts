'use strict';

import type { ExpressRequest, ExpressResponse } from '../types/express';

const express = require('express');
const { requireInterviewer } = require('../auth/middleware');
const loader = require('../challenges/loader');

const router = express.Router();

router.get('/', requireInterviewer, (_req: ExpressRequest, res: ExpressResponse) => {
  res.json({ challenges: loader.listPublicChallenges() });
});

router.get('/:id', (req: ExpressRequest, res: ExpressResponse) => {
  const c = loader.getPublicChallenge(req.params.id);
  if (!c) return res.status(404).json({ error: 'challenge not found' });
  res.json({ challenge: c });
});

module.exports = router;
