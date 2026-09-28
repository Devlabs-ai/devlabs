'use strict';

/**
 * Solution-peek penalty: opening a lab's solution before its first passed
 * submit halves the tokens that lab awards. Only the first view is kept, and a
 * view after the lab is already solved costs nothing.
 */

const pool = require('../db/pool');
const { sanitizeOwner } = require('../workspace/workspaceStore');

const SOLUTION_PENALTY_PCT = 50;

function ownerKey(rawUserId: string | null | undefined): string | null {
  const userId = sanitizeOwner(rawUserId || '');
  return userId && userId !== 'anonymous' ? userId : null;
}

/** Tokens a lab awards after the penalty (rounded down). */
function penalizedTokens(tokens: number): number {
  return Math.floor((tokens * (100 - SOLUTION_PENALTY_PCT)) / 100);
}

function earnedTokens(tokens: number, solvedAt: number | null, viewedAt: number | null): number {
  if (solvedAt == null) return 0;
  return viewedAt != null && viewedAt < solvedAt ? penalizedTokens(tokens) : tokens;
}

async function recordSolutionView(rawUserId: string | null | undefined, challengeId: string): Promise<number | null> {
  const userId = ownerKey(rawUserId);
  if (!userId) return null;
  const { rows } = await pool.query(
    `INSERT INTO solution_views (user_id, challenge_id, viewed_at)
          VALUES ($1, $2, $3)
     ON CONFLICT (user_id, challenge_id) DO UPDATE SET viewed_at = solution_views.viewed_at
       RETURNING viewed_at`,
    [userId, challengeId, Date.now()],
  );
  return rows[0] ? Number(rows[0].viewed_at) : null;
}

async function listSolutionViews(rawUserId: string | null | undefined): Promise<Map<string, number>> {
  const userId = ownerKey(rawUserId);
  const out = new Map<string, number>();
  if (!userId) return out;
  const { rows } = await pool.query(
    'SELECT challenge_id, viewed_at FROM solution_views WHERE user_id = $1',
    [userId],
  );
  for (const r of rows as Array<{ challenge_id: string; viewed_at: string | number }>) {
    out.set(r.challenge_id, Number(r.viewed_at));
  }
  return out;
}

module.exports = {
  SOLUTION_PENALTY_PCT,
  penalizedTokens,
  earnedTokens,
  recordSolutionView,
  listSolutionViews,
};
