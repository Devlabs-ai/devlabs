'use strict';

const express = require('express');
const { requireInterviewer } = require('../auth/middleware');
const loader = require('../challenges/loader');

const router = express.Router();

router.get('/', requireInterviewer, (_req, res) => {
  res.json({ challenges: loader.listPublicChallenges() });
});

router.get('/:id', (req, res) => {
  const c = loader.getPublicChallenge(req.params.id);
  if (!c) return res.status(404).json({ error: 'challenge not found' });
  res.json({ challenge: c });
});

module.exports = router;
