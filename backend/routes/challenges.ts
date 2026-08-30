'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { requireInterviewer, requireAdmin, isAdminUser } = require('../auth/middleware');
const loader = require('../challenges/loader');
const {
  hydrateChallengeFromMinio,
  loadSolutionFiles,
  loadChallengeMeta,
  writeChallengeMeta,
  writeSolutionFiles,
  applyMoatPolicy,
} = require('../challenges/minioChallengeAssets');
const { listSolvedChallengeIds, countSubmittersByChallenge } = require('../challenges/userProgress');
const pool = require('../db/pool');

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
    const challenges = loader.listPublicChallenges().map((c: { id: string; problemStatement?: unknown }) => ({
      ...c,
      solved: solvedIds.has(c.id),
      submitters: submitterCounts.get(c.id) || 0,
    }));
    res.json({
      challenges: isAdminUser(req.user)
        ? challenges
        : challenges.map((c: Record<string, unknown>) => applyMoatPolicy(c, req.user)),
    });
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
    const forClient = applyMoatPolicy(hydrated as Record<string, unknown>, req.user);
    res.json({
      challenge: {
        ...forClient,
        solved: solvedIds.has(String((hydrated as { id?: string }).id || req.params.id)),
      },
    });
  } catch (e) {
    next(e);
  }
});

const CONTENT_TABS = new Set(['description', 'data', 'spec', 'knobs', 'solution', 'moat']);

async function syncCatalogRow(meta: {
  id: string;
  title?: string;
  description?: string;
  problemStatement?: Record<string, unknown>;
  platformSpec?: Record<string, unknown>;
}): Promise<void> {
  const now = Date.now();
  const result = await pool.query(
    `UPDATE challenges
        SET description = COALESCE($2, description),
            problem_statement = COALESCE($3::jsonb, problem_statement),
            platform_spec = COALESCE($4::jsonb, platform_spec),
            updated_at = $5
      WHERE id = $1
      RETURNING *`,
    [
      meta.id,
      meta.description ?? null,
      meta.problemStatement ? JSON.stringify(meta.problemStatement) : null,
      meta.platformSpec ? JSON.stringify(meta.platformSpec) : null,
      now,
    ],
  );
  if (result.rows[0]) loader.cacheFromRow(result.rows[0]);
}

// PUT /api/challenges/:id/content — admin authoring of MinIO challenge.json / solution/
router.put(
  '/:id/content',
  requireAdmin,
  express.json({ limit: '2mb' }),
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const id = String(req.params.id || '');
      const base = loader.getPublicChallenge(id);
      if (!base) return res.status(404).json({ error: 'challenge not found' });
      const tab = String((req.body as Record<string, unknown>)?.tab || '');
      if (!CONTENT_TABS.has(tab)) {
        return res.status(400).json({ error: 'tab must be description, data, spec, knobs, solution, or moat' });
      }

      const body = (req.body as Record<string, unknown>) || {};
      let solutionFiles: Record<string, string> | null = null;

      if (tab === 'solution') {
        const files = body.solutionFiles;
        if (!files || typeof files !== 'object' || Array.isArray(files)) {
          return res.status(400).json({ error: 'solutionFiles object required' });
        }
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries(files as Record<string, unknown>)) {
          map[k] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
        }
        solutionFiles = await writeSolutionFiles(id, map);
      } else {
        const meta = await loadChallengeMeta(id);
        if (!meta) {
          return res.status(404).json({
            error: `challenge.json missing in MinIO for ${id}`,
          });
        }
        const ps = {
          ...((meta.problemStatement && typeof meta.problemStatement === 'object')
            ? meta.problemStatement
            : {}),
        } as Record<string, unknown>;
        const spec = {
          ...((meta.platformSpec && typeof meta.platformSpec === 'object')
            ? meta.platformSpec
            : {}),
        } as Record<string, unknown>;

        if (tab === 'description') {
          if (typeof body.markdown !== 'string') {
            return res.status(400).json({ error: 'markdown string required' });
          }
          meta.description = body.markdown.replace(/^\uFEFF/, '');
        } else if (tab === 'moat') {
          if (typeof body.markdown !== 'string') {
            return res.status(400).json({ error: 'markdown string required' });
          }
          ps.moat = body.markdown.replace(/^\uFEFF/, '');
          meta.problemStatement = ps;
        } else if (tab === 'data') {
          if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
            return res.status(400).json({ error: 'data object required' });
          }
          ps.data = body.data;
          meta.problemStatement = ps;
        } else if (tab === 'spec') {
          const specPatch = body.spec;
          if (!specPatch || typeof specPatch !== 'object' || Array.isArray(specPatch)) {
            return res.status(400).json({ error: 'spec object required' });
          }
          const patch = specPatch as Record<string, unknown>;
          if ('expectedOutput' in patch) ps.expectedOutput = patch.expectedOutput;
          if ('gradeChecks' in patch) spec.gradeChecks = patch.gradeChecks;
          if ('limits' in patch) spec.limits = patch.limits;
          if ('sparkConf' in patch) spec.sparkConf = patch.sparkConf;
          if ('gradeKeys' in patch) spec.gradeKeys = patch.gradeKeys;
          if ('outputFormat' in patch) spec.outputFormat = patch.outputFormat;
          if ('txnInputPath' in patch) spec.txnInputPath = patch.txnInputPath;
          if ('rateInputPath' in patch) spec.rateInputPath = patch.rateInputPath;
          if ('eventsInputPath' in patch) spec.eventsInputPath = patch.eventsInputPath;
          if ('catalogInputPath' in patch) spec.catalogInputPath = patch.catalogInputPath;
          if ('evalSolutionPath' in patch) spec.evalSolutionPath = patch.evalSolutionPath;
          if ('gradeScript' in patch) spec.gradeScript = patch.gradeScript;
          meta.problemStatement = ps;
          meta.platformSpec = spec;
        } else if (tab === 'knobs') {
          if (!Array.isArray(body.knobs)) {
            return res.status(400).json({ error: 'knobs array required' });
          }
          spec.knobs = body.knobs;
          meta.platformSpec = spec;
        }

        await writeChallengeMeta(meta);
        await syncCatalogRow({
          id,
          description: meta.description,
          problemStatement: meta.problemStatement,
          platformSpec: meta.platformSpec,
        });
      }

      const hydrated = await hydrateChallengeFromMinio(loader.getPublicChallenge(id));
      res.json({
        challenge: hydrated,
        ...(solutionFiles ? { solutionFiles } : {}),
      });
    } catch (e) {
      next(e);
    }
  },
);

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
