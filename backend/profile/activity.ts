'use strict';

const pool = require('../db/pool');

/** Must match the avatar ids rendered by frontend/src/components/Avatar.tsx. */
const AVATAR_IDS = [
  'emerald', 'ocean', 'sunset', 'violet', 'amber', 'rose',
  'mint', 'slate', 'aurora', 'ember', 'glacier', 'orchid',
];

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_DAYS = 371;

function isAvatarId(value: unknown): value is string {
  return typeof value === 'string' && AVATAR_IDS.includes(value);
}

/** Minutes from `Date#getTimezoneOffset()`; clamp anything outside real-world zones. */
function parseTzOffset(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= -840 && n <= 840 ? n : 0;
}

/**
 * Lab runs/submits plus paper quizzes per local calendar day over roughly the
 * last year. `ownerId` is the sanitized user id used by submissions/quizzes.
 */
async function activityFor(ownerId: string, tzOffsetMin: number): Promise<Array<{ day: string; count: number }>> {
  const since = Date.now() - ACTIVITY_DAYS * DAY_MS;
  const shift = tzOffsetMin * 60 * 1000;
  const { rows } = await pool.query(
    `SELECT day, SUM(n)::int AS count FROM (
       SELECT to_char(to_timestamp((submitted_at - $2::bigint) / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              COUNT(*) AS n
         FROM submissions
        WHERE regexp_replace(user_id, '[^a-zA-Z0-9_-]', '_', 'g') = $1
          AND submitted_at >= $3
        GROUP BY 1
       UNION ALL
       SELECT to_char(to_timestamp((created_at - $2::bigint) / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              COUNT(*) AS n
         FROM paper_quiz_attempts
        WHERE user_id = $1
          AND created_at >= $3
        GROUP BY 1
     ) a
     GROUP BY day
     ORDER BY day`,
    [ownerId, shift, since],
  );
  return (rows as Array<{ day: string; count: number }>).map((r) => ({ day: r.day, count: Number(r.count) || 0 }));
}

module.exports = { AVATAR_IDS, isAvatarId, parseTzOffset, activityFor };
