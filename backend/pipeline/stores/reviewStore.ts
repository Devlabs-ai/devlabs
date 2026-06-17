'use strict';

const pool = require('../../db/pool');

interface ReviewRecord {
  sessionId: string;
  title: string | null;
  builtChallenge: unknown;
  buildValidation: unknown;
  buildDir: string | null;
  savedAt: number;
}

async function upsert({
  draftSessionId,
  title,
  builtChallenge,
  buildValidation,
  buildDir,
}: {
  draftSessionId: string;
  title?: string | null;
  builtChallenge?: unknown;
  buildValidation?: unknown;
  buildDir?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO reviews (session_id, title, built_challenge, build_validation, build_dir, saved_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (session_id) DO UPDATE SET
       title = EXCLUDED.title,
       built_challenge = EXCLUDED.built_challenge,
       build_validation = EXCLUDED.build_validation,
       build_dir = EXCLUDED.build_dir,
       saved_at = EXCLUDED.saved_at`,
    [
      draftSessionId,
      title || null,
      builtChallenge ? JSON.stringify(builtChallenge) : null,
      buildValidation ? JSON.stringify(buildValidation) : null,
      buildDir || null,
      Date.now(),
    ],
  );
}

function rowToReview(r: Record<string, unknown>): ReviewRecord {
  return {
    sessionId: r.session_id as string,
    title: r.title as string | null,
    builtChallenge: r.built_challenge,
    buildValidation: r.build_validation,
    buildDir: r.build_dir as string | null,
    savedAt: Number(r.saved_at),
  };
}

async function list(): Promise<ReviewRecord[]> {
  const { rows } = await pool.query(`SELECT * FROM reviews ORDER BY saved_at DESC`);
  return rows.map(rowToReview);
}

async function get(draftSessionId: string): Promise<ReviewRecord | null> {
  const { rows } = await pool.query(`SELECT * FROM reviews WHERE session_id = $1`, [draftSessionId]);
  return rows[0] ? rowToReview(rows[0]) : null;
}

async function remove(draftSessionId: string): Promise<void> {
  await pool.query(`DELETE FROM reviews WHERE session_id = $1`, [draftSessionId]);
}

module.exports = { upsert, list, get, remove };
