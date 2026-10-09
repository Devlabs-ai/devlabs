'use strict';

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');

export interface ChallengeReview {
  id: string;
  challengeId: string;
  authorId: string;
  authorEmail: string | null;
  authorName: string | null;
  body: string;
  createdAt: number;
  updatedAt: number;
}

function mapReview(row: Record<string, unknown> | null | undefined): ChallengeReview | null {
  if (!row) return null;
  return {
    id: String(row.id),
    challengeId: String(row.challenge_id),
    authorId: String(row.author_id),
    authorEmail: (row.author_email as string | null) || null,
    authorName: (row.author_name as string | null) || null,
    body: String(row.body || ''),
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

async function listReviews(challengeId: string): Promise<ChallengeReview[]> {
  const { rows } = await pool.query(
    `SELECT id, challenge_id, author_id, author_email, author_name, body, created_at, updated_at
       FROM challenge_reviews
      WHERE challenge_id = $1
      ORDER BY created_at ASC`,
    [challengeId],
  );
  return rows.map((r: Record<string, unknown>) => mapReview(r)!).filter(Boolean);
}

async function createReview({
  challengeId,
  authorId,
  authorEmail,
  authorName,
  body,
}: {
  challengeId: string;
  authorId: string;
  authorEmail?: string | null;
  authorName?: string | null;
  body: string;
}): Promise<ChallengeReview> {
  const now = Date.now();
  const text = String(body || '').trim();
  if (!text) throw Object.assign(new Error('Feedback cannot be empty'), { status: 400 });
  const { rows } = await pool.query(
    `INSERT INTO challenge_reviews
       (id, challenge_id, author_id, author_email, author_name, body, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     RETURNING id, challenge_id, author_id, author_email, author_name, body, created_at, updated_at`,
    [
      uuidv4(),
      challengeId,
      authorId,
      authorEmail || null,
      authorName || null,
      text,
      now,
    ],
  );
  return mapReview(rows[0])!;
}

async function deleteReview(reviewId: string, challengeId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM challenge_reviews WHERE id = $1 AND challenge_id = $2`,
    [reviewId, challengeId],
  );
  return rowCount > 0;
}

module.exports = {
  listReviews,
  createReview,
  deleteReview,
};
