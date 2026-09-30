'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { requireInterviewer } = require('../auth/middleware');
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

module.exports = router;
