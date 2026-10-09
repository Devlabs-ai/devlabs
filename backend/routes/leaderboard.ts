'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const crypto = require('crypto');
const express = require('express');
const { requireInterviewer } = require('../auth/middleware');
const { getMonthlyPaper } = require('../papers/monthlyPapers');
const { parseTzOffset, activityFor } = require('../profile/activity');
const { sanitizeOwner } = require('../workspace/workspaceStore');
const pool = require('../db/pool');
const loader = require('../challenges/loader');
const { SOLUTION_PENALTY_PCT } = require('../challenges/solutionViews');

const router = express.Router();

const MAX_IDS = 300;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;

type Row = {
  user_id: string;
  solved: number;
  tokens: number;
  last_solved_at: string | number | null;
  name: string | null;
  email: string | null;
};

function displayName(row: Row): string {
  const name = String(row.name || '').trim();
  if (name) return name;
  const local = String(row.email || '').split('@')[0].trim();
  return local || 'Learner';
}

/**
 * GET /api/leaderboard?challengeIds=a,b,c[&limit=N]  (default 50, max 1000)
 * Ranks learners by tokens earned from first passed submits on those labs
 * (ties: more labs solved, then whoever got there first).
 */
router.get('/', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const raw = String((req.query as Record<string, unknown>).challengeIds || '');
    const ids = Array.from(new Set(raw.split(',').map((s) => s.trim()).filter((s) => ID_RE.test(s))))
      .filter((id) => !loader.getChallenge(id)?.k8sPlatform?.practice)
      .slice(0, MAX_IDS);
    if (!ids.length) return res.json({ totalLabs: 0, entries: [], me: null });

    const meSub = (req.user as { sub?: string; id?: string } | undefined)?.sub
      || (req.user as { sub?: string; id?: string } | undefined)?.id
      || '';
    const meId = meSub ? sanitizeOwner(meSub) : '';

    const { rows } = await pool.query(
      `WITH solves AS (
         SELECT user_id, challenge_id, MIN(submitted_at) AS solved_at
           FROM submissions
          WHERE mode = 'submit'
            AND grade_status = 'passed'
            AND challenge_id = ANY($1::text[])
            AND user_id IS NOT NULL
            AND user_id NOT IN ('', 'anonymous')
          GROUP BY user_id, challenge_id
       )
       SELECT s.user_id,
              COUNT(*)::int                    AS solved,
              COALESCE(SUM(
                CASE WHEN v.viewed_at IS NOT NULL AND v.viewed_at < s.solved_at
                     THEN FLOOR(COALESCE(c.tokens, 10) * (100 - $2::int) / 100.0)
                     ELSE COALESCE(c.tokens, 10)
                END
              ), 0)::int                       AS tokens,
              MAX(s.solved_at)                 AS last_solved_at,
              MAX(u.name)                      AS name,
              MAX(u.email)                     AS email
         FROM solves s
         LEFT JOIN challenges c ON c.id = s.challenge_id
         LEFT JOIN solution_views v
                ON v.challenge_id = s.challenge_id
               AND v.user_id = regexp_replace(s.user_id, '[^a-zA-Z0-9_-]', '_', 'g')
         LEFT JOIN users u ON regexp_replace(u.id, '[^a-zA-Z0-9_-]', '_', 'g') = s.user_id
        GROUP BY s.user_id
        ORDER BY tokens DESC, solved DESC, last_solved_at ASC`,
      [ids, SOLUTION_PENALTY_PCT],
    );

    const ranked = (rows as Row[]).map((r, i) => ({
      rank: i + 1,
      name: displayName(r),
      solved: Number(r.solved) || 0,
      tokens: Number(r.tokens) || 0,
      lastSolvedAt: r.last_solved_at != null ? Number(r.last_solved_at) : null,
      isMe: Boolean(meId) && r.user_id === meId,
    }));

    const limitRaw = Number((req.query as Record<string, unknown>).limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(MAX_LIMIT, Math.trunc(limitRaw)) : DEFAULT_LIMIT;
    const entries = ranked.slice(0, limit);
    const me = ranked.find((e) => e.isMe) || null;
    res.json({ totalLabs: ids.length, participants: ranked.length, entries, me });
  } catch (e) {
    next(e);
  }
});

type PlatformRow = Row & { papers: number; avatar: string | null };

/** Opaque, stable handle for a learner's public profile; never exposes the user id or email. */
function publicId(userId: string): string {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'devlabs-dev-secret')
    .update(`learner:${userId}`)
    .digest('base64url')
    .slice(0, 16);
}

function practiceLabIds(): string[] {
  return (loader.listChallenges() as Array<{ id: string; k8sPlatform?: { practice?: boolean } }>)
    .filter((c) => c.k8sPlatform?.practice)
    .map((c) => c.id);
}

function requesterId(req: ExpressRequest): string {
  const user = req.user as { sub?: string; id?: string } | undefined;
  const sub = user?.sub || user?.id || '';
  return sub ? sanitizeOwner(sub) : '';
}

/**
 * Lifetime tokens across the platform: every non-practice lab plus Paper of the
 * Week quizzes. Earned tokens only ever add up, so spending them later does not
 * lower a rank.
 */
async function rankPlatform(practiceIds: string[]): Promise<PlatformRow[]> {
  const { rows } = await pool.query(
      `WITH solves AS (
         SELECT regexp_replace(user_id, '[^a-zA-Z0-9_-]', '_', 'g') AS user_id,
                challenge_id, MIN(submitted_at) AS solved_at
           FROM submissions
          WHERE mode = 'submit'
            AND grade_status = 'passed'
            AND NOT (challenge_id = ANY($1::text[]))
            AND user_id IS NOT NULL
            AND user_id NOT IN ('', 'anonymous')
          GROUP BY 1, challenge_id
       ),
       labs AS (
         SELECT s.user_id,
                COUNT(*)::int AS solved,
                COALESCE(SUM(
                  CASE WHEN v.viewed_at IS NOT NULL AND v.viewed_at < s.solved_at
                       THEN FLOOR(COALESCE(c.tokens, 10) * (100 - $2::int) / 100.0)
                       ELSE COALESCE(c.tokens, 10)
                  END
                ), 0)::int AS tokens,
                MAX(s.solved_at) AS last_at
           FROM solves s
           LEFT JOIN challenges c ON c.id = s.challenge_id
           LEFT JOIN solution_views v ON v.challenge_id = s.challenge_id AND v.user_id = s.user_id
          GROUP BY s.user_id
       ),
       papers AS (
         SELECT user_id, COUNT(*)::int AS papers, SUM(tokens)::int AS tokens, MAX(created_at) AS last_at
           FROM paper_quiz_attempts
          GROUP BY user_id
       ),
       totals AS (
         SELECT COALESCE(l.user_id, p.user_id) AS user_id,
                COALESCE(l.solved, 0) AS solved,
                COALESCE(p.papers, 0) AS papers,
                COALESCE(l.tokens, 0) + COALESCE(p.tokens, 0) AS tokens,
                GREATEST(l.last_at, p.last_at) AS last_solved_at
           FROM labs l
           FULL OUTER JOIN papers p ON p.user_id = l.user_id
       )
       SELECT t.*, u.name, u.email, u.avatar
         FROM totals t
         LEFT JOIN users u ON regexp_replace(u.id, '[^a-zA-Z0-9_-]', '_', 'g') = t.user_id
        WHERE t.tokens > 0
        ORDER BY t.tokens DESC, t.last_solved_at ASC`,
    [practiceIds, SOLUTION_PENALTY_PCT],
  );
  return rows as PlatformRow[];
}

function platformEntry(r: PlatformRow, i: number, meId: string) {
  return {
    id: publicId(r.user_id),
    rank: i + 1,
    name: displayName(r),
    avatar: r.avatar || null,
    solved: Number(r.solved) || 0,
    papers: Number(r.papers) || 0,
    tokens: Number(r.tokens) || 0,
    isMe: Boolean(meId) && r.user_id === meId,
  };
}

/** GET /api/leaderboard/platform[?limit=N]  (default 10) */
router.get('/platform', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const meId = requesterId(req);
    const ranked = (await rankPlatform(practiceLabIds())).map((r, i) => platformEntry(r, i, meId));
    const limitRaw = Number((req.query as Record<string, unknown>).limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(MAX_LIMIT, Math.trunc(limitRaw)) : 10;
    res.json({
      participants: ranked.length,
      entries: ranked.slice(0, limit),
      me: ranked.find((e) => e.isMe) || null,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/leaderboard/platform/:id[?tz=<getTimezoneOffset minutes>]
 * Public profile for a ranked learner: totals, solved labs, and paper quizzes.
 */
router.get('/platform/:id', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const id = String((req.params as Record<string, string>).id || '');
    if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return res.status(404).json({ error: 'not_found' });

    const practiceIds = practiceLabIds();
    const rows = await rankPlatform(practiceIds);
    const index = rows.findIndex((r) => publicId(r.user_id) === id);
    if (index < 0) return res.status(404).json({ error: 'not_found' });
    const row = rows[index];

    const tz = parseTzOffset((req.query as Record<string, unknown>).tz);
    const [labs, papers, activity] = await Promise.all([
      pool.query(
        `WITH solves AS (
           SELECT challenge_id, MIN(submitted_at) AS solved_at
             FROM submissions
            WHERE mode = 'submit'
              AND grade_status = 'passed'
              AND NOT (challenge_id = ANY($2::text[]))
              AND regexp_replace(user_id, '[^a-zA-Z0-9_-]', '_', 'g') = $1
            GROUP BY challenge_id
         )
         SELECT s.challenge_id, s.solved_at,
                CASE WHEN v.viewed_at IS NOT NULL AND v.viewed_at < s.solved_at
                     THEN FLOOR(COALESCE(c.tokens, 10) * (100 - $3::int) / 100.0)
                     ELSE COALESCE(c.tokens, 10)
                END::int AS tokens
           FROM solves s
           LEFT JOIN challenges c ON c.id = s.challenge_id
           LEFT JOIN solution_views v ON v.challenge_id = s.challenge_id AND v.user_id = $1
          ORDER BY s.solved_at DESC`,
        [row.user_id, practiceIds, SOLUTION_PENALTY_PCT],
      ),
      pool.query(
        `SELECT paper_id, correct, total, tokens, created_at
           FROM paper_quiz_attempts
          WHERE user_id = $1
          ORDER BY created_at DESC`,
        [row.user_id],
      ),
      activityFor(row.user_id, tz),
    ]);

    type LabRow = { challenge_id: string; solved_at: string | number; tokens: number };
    type PaperRow = { paper_id: string; correct: number; total: number; tokens: number; created_at: string | number };

    res.json({
      ...platformEntry(row, index, requesterId(req)),
      participants: rows.length,
      activity,
      solvedLabs: (labs.rows as LabRow[]).map((l) => {
        const challenge = loader.getChallenge(l.challenge_id);
        return {
          title: challenge?.title || l.challenge_id,
          difficulty: challenge?.difficulty || null,
          tokens: Number(l.tokens) || 0,
          solvedAt: Number(l.solved_at) || null,
        };
      }),
      paperQuizzes: (papers.rows as PaperRow[]).map((p) => ({
        title: getMonthlyPaper(p.paper_id)?.title || p.paper_id,
        correct: Number(p.correct) || 0,
        total: Number(p.total) || 0,
        tokens: Number(p.tokens) || 0,
        takenAt: Number(p.created_at) || null,
      })),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
