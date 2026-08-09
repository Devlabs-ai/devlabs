'use strict';

/**
 * Per-user challenge progress derived from scored submissions.
 * A challenge is solved when the user has ≥1 submit with grade_status=passed.
 */

const pool = require('../db/pool');
const { sanitizeOwner } = require('../workspace/workspaceStore');

async function listSolvedChallengeIds(rawUserId: string | null | undefined): Promise<Set<string>> {
  const userId = sanitizeOwner(rawUserId || '');
  if (!userId || userId === 'anonymous') return new Set();

  const { rows } = await pool.query(
    `SELECT DISTINCT challenge_id AS id
       FROM submissions
      WHERE user_id = $1
        AND challenge_id IS NOT NULL
        AND mode = 'submit'
        AND grade_status = 'passed'`,
    [userId],
  );

  return new Set(
    (rows as Array<{ id: string | null }>)
      .map((r) => String(r.id || '').trim())
      .filter(Boolean),
  );
}

/** Distinct users who have submitted each challenge (scored submit mode). */
async function countSubmittersByChallenge(): Promise<Map<string, number>> {
  const { rows } = await pool.query(
    `SELECT challenge_id AS id, COUNT(DISTINCT user_id)::int AS submitters
       FROM submissions
      WHERE challenge_id IS NOT NULL
        AND user_id IS NOT NULL
        AND user_id <> ''
        AND user_id <> 'anonymous'
        AND mode = 'submit'
      GROUP BY challenge_id`,
  );

  const out = new Map<string, number>();
  for (const row of rows as Array<{ id: string | null; submitters: number | null }>) {
    const id = String(row.id || '').trim();
    if (!id) continue;
    out.set(id, Number(row.submitters) || 0);
  }
  return out;
}

module.exports = {
  listSolvedChallengeIds,
  countSubmittersByChallenge,
};
