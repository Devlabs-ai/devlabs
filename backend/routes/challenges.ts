'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { requireInterviewer } = require('../auth/middleware');
const loader = require('../challenges/loader');
const {
  hydrateChallengeFromMinio,
  loadSolutionFiles,
} = require('../challenges/minioChallengeAssets');
const { listSolvedChallengeIds, countSubmittersByChallenge } = require('../challenges/userProgress');

const router = express.Router();

router.get('/', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    // Shelf stays on thin Postgres rows; attach per-user solved from graded submits.
    const userId = (req.user as { sub?: string; id?: string } | undefined)?.sub
      || (req.user as { sub?: string; id?: string } | undefined)?.id
      || null;
    const [solvedIds, submitterCounts] = await Promise.all([
      listSolvedChallengeIds(userId),
      countSubmittersByChallenge(),
    ]);
    const challenges = loader.listPublicChallenges().map((c: { id: string }) => ({
      ...c,
      solved: solvedIds.has(c.id),
      submitters: submitterCounts.get(c.id) || 0,
    }));
    res.json({ challenges });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    // Existence / thin catalog from Postgres; open body from MinIO when contentSource=minio.
    const c = loader.getPublicChallenge(req.params.id);
    if (!c) return res.status(404).json({ error: 'challenge not found' });
    const hydrated = await hydrateChallengeFromMinio(c);
    const userId = (req.user as { sub?: string; id?: string } | undefined)?.sub
      || (req.user as { sub?: string; id?: string } | undefined)?.id
      || null;
    const solvedIds = await listSolvedChallengeIds(userId);
    res.json({
      challenge: {
        ...hydrated,
        solved: solvedIds.has(String((hydrated as { id?: string }).id || req.params.id)),
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/challenges/:id/solution — reference files from MinIO challenges/<id>/solution/
router.get('/:id/solution', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const c = loader.getPublicChallenge(req.params.id);
    if (!c) return res.status(404).json({ error: 'challenge not found' });

    const files = await loadSolutionFiles(req.params.id);
    if (!files) {
      return res.status(404).json({
        error: `No solution/ in MinIO for ${req.params.id}. Re-publish the challenge.`,
      });
    }

    const entrypoint =
      ((c.sparkPlatform as { starterFileName?: string } | null)?.starterFileName)
      || 'src/main.py';

    res.json({
      challengeId: req.params.id,
      entrypoint,
      files,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
