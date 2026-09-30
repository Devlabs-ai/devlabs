'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireInterviewer, requireAdmin, requireReviewStaff, isAdminUser } = require('../auth/middleware');
const loader = require('../challenges/loader');
const {
  hydrateChallengeFromMinio,
  loadSolutionFiles,
  loadChallengeMeta,
  writeChallengeMeta,
  writeSolutionFiles,
  loadSolutionAsset,
  applyMoatPolicy,
} = require('../challenges/minioChallengeAssets');
const {
  listSolvedChallengeIds,
  listFirstSolveTimes,
  countSubmittersByChallenge,
} = require('../challenges/userProgress');
const {
  SOLUTION_PENALTY_PCT,
  penalizedTokens,
  earnedTokens,
  recordSolutionView,
  listSolutionViews,
} = require('../challenges/solutionViews');
const { canViewChallenge } = require('../challenges/access');
const { catalogSettingsLocked, writePackSettings } = require('../challenges/catalogSettings');
const reviewStore = require('../challenges/reviewStore');
const pool = require('../db/pool');

const router = express.Router();

function tokensOf(c: { tokens?: unknown }): number {
  return typeof c.tokens === 'number' && Number.isFinite(c.tokens) ? c.tokens : 10;
}

function requestUserId(req: ExpressRequest): string | null {
  const user = req.user as { sub?: string; id?: string } | undefined;
  return user?.sub || user?.id || null;
}

/** What opening this lab's solution costs the current user. */
async function solutionStatus(req: ExpressRequest, c: { id: string; tokens?: unknown; k8sPlatform?: { practice?: boolean } | null }) {
  const userId = requestUserId(req);
  const [solveTimes, views] = await Promise.all([listFirstSolveTimes(userId), listSolutionViews(userId)]);
  const tokens = tokensOf(c);
  const solvedAt = solveTimes.get(c.id) ?? null;
  const viewedAt = views.get(c.id) ?? null;
  const practice = Boolean(c.k8sPlatform?.practice);
  return {
    challengeId: c.id,
    tokens,
    penaltyPct: SOLUTION_PENALTY_PCT,
    tokensAfterPenalty: penalizedTokens(tokens),
    solved: solvedAt != null,
    viewedAt,
    /** Opening the solution now would (or already did) cut this lab's tokens. */
    penalized: !practice && (viewedAt != null ? solvedAt == null || viewedAt < solvedAt : solvedAt == null),
    practice,
  };
}

router.get('/', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    // Shelf stays on thin Postgres rows; attach per-user solved from graded submits.
    const userId = (req.user as { sub?: string; id?: string } | undefined)?.sub
      || (req.user as { sub?: string; id?: string } | undefined)?.id
      || null;
    const [solveTimes, solutionViews, submitterCounts] = await Promise.all([
      listFirstSolveTimes(userId),
      listSolutionViews(userId),
      countSubmittersByChallenge(),
    ]);
    const challenges = loader
      .listPublicChallenges()
      .filter((c: { visibleTo?: string }) => canViewChallenge(req.user, c.visibleTo))
      .map((c: { id: string; tokens?: number; problemStatement?: unknown }) => {
        const solvedAt = solveTimes.get(c.id) ?? null;
        const viewedAt = solutionViews.get(c.id) ?? null;
        return {
          ...c,
          solved: solvedAt != null,
          earnedTokens: earnedTokens(tokensOf(c), solvedAt, viewedAt),
          solutionViewedAt: viewedAt,
          submitters: submitterCounts.get(c.id) || 0,
        };
      });
    res.json({
      challenges: isAdminUser(req.user)
        ? challenges
        : challenges.map((c: Record<string, unknown>) => applyMoatPolicy(c, req.user)),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/catalog-settings', requireAdmin, (_req: ExpressRequest, res: ExpressResponse) => {
  res.json({ locked: catalogSettingsLocked() });
});

router.get('/:id', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    // Existence / thin catalog from Postgres; open body from MinIO when contentSource=minio.
    const c = loader.getPublicChallenge(req.params.id);
    if (!c) return res.status(404).json({ error: 'challenge not found' });
    if (!canViewChallenge(req.user, (c as { visibleTo?: string }).visibleTo)) {
      return res.status(403).json({ error: 'This lab is not available for your role' });
    }
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

router.put(
  '/:id/visibility',
  requireAdmin,
  express.json({ limit: '32kb' }),
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const id = String(req.params.id || '');
      const existing = loader.getChallenge(id);
      if (!existing) return res.status(404).json({ error: 'challenge not found' });

      const body = (req.body as {
        visibleTo?: unknown;
        visibilityNotes?: unknown;
        tokens?: unknown;
        bounty?: unknown;
      }) || {};
      const visibleTo = String(body.visibleTo || '').trim().toLowerCase();
      if (visibleTo !== 'admin' && visibleTo !== 'users' && visibleTo !== 'reviewers') {
        return res.status(400).json({ error: 'visibleTo must be admin, reviewers, or users' });
      }

      const notes =
        body.visibilityNotes !== undefined ? String(body.visibilityNotes ?? '') : null;
      const tokensRaw =
        body.tokens !== undefined && body.tokens !== null && body.tokens !== ''
          ? body.tokens
          : body.bounty !== undefined && body.bounty !== null && body.bounty !== ''
            ? body.bounty
            : null;
      const tokens = tokensRaw != null ? Number(tokensRaw) : null;
      if (tokens != null && (!Number.isFinite(tokens) || tokens < 0)) {
        return res.status(400).json({ error: 'tokens must be a non-negative number' });
      }

      if (catalogSettingsLocked()) {
        const currentVisibleTo = (existing as { visibleTo?: string }).visibleTo || 'admin';
        const currentTokens = (existing as { tokens?: number }).tokens ?? 10;
        const changesVisibility = visibleTo !== currentVisibleTo;
        const changesTokens = tokens != null && Math.trunc(tokens) !== currentTokens;
        if (changesVisibility || changesTokens) {
          return res.status(409).json({
            error:
              'Visibility and tokens are managed from local and synced on deploy. Change them locally, then redeploy.',
          });
        }
      }

      const updated = await loader.setVisibleTo(id, visibleTo, notes, tokens);
      if (!catalogSettingsLocked()) {
        writePackSettings(id, {
          visibleTo: updated.visibleTo || visibleTo,
          tokens: typeof updated.tokens === 'number' ? updated.tokens : undefined,
        });
      }
      res.json({
        challenge: {
          id: updated.id,
          visibleTo: updated.visibleTo || 'admin',
          visibilityNotes: updated.visibilityNotes || '',
          tokens: typeof updated.tokens === 'number' ? updated.tokens : 10,
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/reviews',
  requireReviewStaff,
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const id = String(req.params.id || '');
      if (!loader.getChallenge(id)) return res.status(404).json({ error: 'challenge not found' });
      const reviews = await reviewStore.listReviews(id);
      res.json({ reviews });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/reviews',
  requireReviewStaff,
  express.json({ limit: '256kb' }),
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const id = String(req.params.id || '');
      if (!loader.getChallenge(id)) return res.status(404).json({ error: 'challenge not found' });

      const authorId = String(req.user?.sub || req.user?.userId || '');
      if (!authorId) return res.status(401).json({ error: 'unauthenticated' });

      const body = String((req.body as { body?: unknown })?.body || '');
      const review = await reviewStore.createReview({
        challengeId: id,
        authorId,
        authorEmail: req.user?.email || null,
        authorName: null,
        body,
      });
      res.status(201).json({ review });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 400) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(e);
    }
  },
);

router.delete(
  '/:id/reviews/:reviewId',
  requireReviewStaff,
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const id = String(req.params.id || '');
      const reviewId = String(req.params.reviewId || '');
      if (!loader.getChallenge(id)) return res.status(404).json({ error: 'challenge not found' });

      const reviews = await reviewStore.listReviews(id);
      const target = reviews.find((r: { id: string }) => r.id === reviewId);
      if (!target) return res.status(404).json({ error: 'review not found' });

      const authorId = String(req.user?.sub || req.user?.userId || '');
      if (!isAdminUser(req.user) && target.authorId !== authorId) {
        return res.status(403).json({ error: 'can only delete your own feedback' });
      }

      await reviewStore.deleteReview(reviewId, id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

const CONTENT_TABS = new Set([
  'description',
  'theory',
  'data',
  'spec',
  'cluster',
  'knobs',
  'solution',
  'moat',
]);

function updatePackJson(
  id: string,
  patch: {
    description?: string;
    problemStatement?: Record<string, unknown>;
  },
): void {
  const packPath = path.join(__dirname, '../challenges/packs', `${id}.json`);
  if (!fs.existsSync(packPath)) return;
  try {
    const data = JSON.parse(fs.readFileSync(packPath, 'utf8')) as Record<string, unknown>;
    if (typeof patch.description === 'string') data.description = patch.description;
    if (patch.problemStatement && typeof patch.problemStatement === 'object') {
      const prev =
        data.problemStatement && typeof data.problemStatement === 'object' && !Array.isArray(data.problemStatement)
          ? (data.problemStatement as Record<string, unknown>)
          : {};
      data.problemStatement = { ...prev, ...patch.problemStatement };
    }
    fs.writeFileSync(packPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch (e: unknown) {
    console.warn(`[challenges] pack update skipped for ${id}:`, (e as Error).message);
  }
}

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
        SET title = COALESCE($2, title),
            description = COALESCE($3, description),
            problem_statement = COALESCE($4::jsonb, problem_statement),
            platform_spec = COALESCE($5::jsonb, platform_spec),
            updated_at = $6
      WHERE id = $1
      RETURNING *`,
    [
      meta.id,
      meta.title ?? null,
      meta.description ?? null,
      meta.problemStatement ? JSON.stringify(meta.problemStatement) : null,
      meta.platformSpec ? JSON.stringify(meta.platformSpec) : null,
      now,
    ],
  );
  if (result.rows[0]) loader.cacheFromRow(result.rows[0]);
}

// PUT /api/challenges/:id/content — admin authoring of MinIO challenge.json / solution/
// (Kubernetes pack labs update Postgres + packs/*.json instead of MinIO.)
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
        return res.status(400).json({
          error: 'tab must be description, theory, data, spec, cluster, knobs, solution, or moat',
        });
      }

      const body = (req.body as Record<string, unknown>) || {};
      let solutionFiles: Record<string, string> | null = null;
      const isK8s = base.sandboxType === 'kubernetes';

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

        // Keep pack problemStatement.solution in sync with README when present (k8s brief fallback).
        if (isK8s && typeof map['README.md'] === 'string') {
          const ps = {
            ...((base.problemStatement && typeof base.problemStatement === 'object')
              ? (base.problemStatement as Record<string, unknown>)
              : {}),
            solution: map['README.md'],
          };
          await syncCatalogRow({ id, problemStatement: ps });
          updatePackJson(id, { problemStatement: ps });
        }
      } else if (isK8s) {
        const ps = {
          ...((base.problemStatement && typeof base.problemStatement === 'object')
            ? (base.problemStatement as Record<string, unknown>)
            : {}),
        };
        let description: string | undefined;
        if (tab === 'description') {
          if (typeof body.markdown !== 'string') {
            return res.status(400).json({ error: 'markdown string required' });
          }
          description = body.markdown.replace(/^\uFEFF/, '');
        } else if (tab === 'theory') {
          if (typeof body.markdown !== 'string') {
            return res.status(400).json({ error: 'markdown string required' });
          }
          ps.theory = body.markdown.replace(/^\uFEFF/, '');
        } else if (tab === 'moat') {
          if (typeof body.markdown !== 'string') {
            return res.status(400).json({ error: 'markdown string required' });
          }
          ps.moat = body.markdown.replace(/^\uFEFF/, '');
        } else {
          return res.status(400).json({
            error: 'Kubernetes labs support editing description, theory, solution (and moat)',
          });
        }
        await syncCatalogRow({
          id,
          description,
          problemStatement: ps,
        });
        updatePackJson(id, {
          ...(description !== undefined ? { description } : {}),
          problemStatement: ps,
        });
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
        } else if (tab === 'theory') {
          if (typeof body.markdown !== 'string') {
            return res.status(400).json({ error: 'markdown string required' });
          }
          ps.theory = body.markdown.replace(/^\uFEFF/, '');
          meta.problemStatement = ps;
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
          if ('scoring' in patch) spec.scoring = patch.scoring;
          meta.problemStatement = ps;
          meta.platformSpec = spec;
        } else if (tab === 'cluster') {
          const cluster = body.cluster;
          if (!cluster || typeof cluster !== 'object' || Array.isArray(cluster)) {
            return res.status(400).json({ error: 'cluster object required' });
          }
          const patch = cluster as Record<string, unknown>;
          if ('limits' in patch) spec.limits = patch.limits;
          if ('sparkConf' in patch) spec.sparkConf = patch.sparkConf;
          if ('scoring' in patch) spec.scoring = patch.scoring;
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
          title: meta.title,
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

// GET /api/challenges/:id/solution/assets/:filename — PNG/screenshots from MinIO
router.get(
  '/:id/solution/assets/:filename',
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const c = loader.getPublicChallenge(req.params.id);
      if (!c) return res.status(404).json({ error: 'challenge not found' });

      const filename = String(req.params.filename || '');
      if (!filename || filename.includes('/') || filename.includes('..')) {
        return res.status(400).json({ error: 'invalid asset filename' });
      }

      const asset = await loadSolutionAsset(req.params.id, `assets/${filename}`);
      if (!asset) return res.status(404).json({ error: 'asset not found' });

      res.set('Cache-Control', 'public, max-age=3600');
      res.type(asset.contentType).send(asset.body);
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/challenges/:id/solution-status — token cost of opening the solution for this user
router.get('/:id/solution-status', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const c = loader.getPublicChallenge(req.params.id);
    if (!c || !canViewChallenge(req.user, c.visibleTo)) return res.status(404).json({ error: 'challenge not found' });
    res.json(await solutionStatus(req, c));
  } catch (e) {
    next(e);
  }
});

// POST /api/challenges/:id/solution-view — record that the user opened the solution (first view wins)
router.post('/:id/solution-view', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const c = loader.getPublicChallenge(req.params.id);
    if (!c || !canViewChallenge(req.user, c.visibleTo)) return res.status(404).json({ error: 'challenge not found' });
    await recordSolutionView(requestUserId(req), c.id);
    res.json(await solutionStatus(req, c));
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
        error: `No solution/ for ${req.params.id}. Publish MinIO solution/ or add challenges/k8s/${req.params.id}/solution/.`,
      });
    }

    const sparkEntrypoint =
      ((c.sparkPlatform as { starterFileName?: string } | null)?.starterFileName)
      || null;
    const entrypoint =
      sparkEntrypoint
      || (files['README.md'] ? 'README.md' : Object.keys(files).sort()[0])
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
