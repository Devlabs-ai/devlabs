'use strict';

// build_memory store — long-term, embeddings-backed memory for the build
// pipeline. Every row is a natural-language paragraph ("lesson_text")
// plus structured details and a 1536-dim embedding. Retrieval is a single
// cosine-distance query against the embedding column; there is NO kind /
// signature-class taxonomy — semantic similarity does the clustering.
//
// Calls are best-effort: any Postgres or embedding API failure logs a
// warning and returns gracefully so memory never blocks a build.

const crypto = require('crypto');
const pool = require('../db/pool');
const llm = require('../llm/client');

// Normalize text into the canonical form we hash for dedup. Trim, collapse
// whitespace, lowercase. Same lesson rendered identically => same hash =>
// hit_count bumps instead of a new row.
function canonicalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sigOf(text) {
  return crypto
    .createHash('sha256')
    .update(canonicalize(text))
    .digest('hex');
}

// Postgres vector literal format: '[0.1,0.2,...]'. The pg driver doesn't
// know about pgvector types, so we cast the bound parameter explicitly
// at the SQL site (`$1::vector`).
function toPgVector(arr) {
  return `[${arr.join(',')}]`;
}

// Record a lesson. `text` is the human-readable paragraph; `details` is
// any structured payload we want to keep alongside (image refs, services,
// before/after excerpts). Returns the inserted/updated row's id, or null
// on failure.
async function record({ text, details = null, category = null }) {
  if (!text || typeof text !== 'string') return null;
  const signature = sigOf(text);
  const now = Date.now();
  // Embed first so the row gets a vector on insert. If embedding is not
  // configured, we still insert (with NULL embedding) so the row is at
  // least visible if we re-embed later.
  let embedding = null;
  try {
    embedding = await llm.embed(text);
  } catch (e) {
    console.warn(`[memory] embed failed at record(): ${e.message}`);
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO build_memory
         (signature, lesson_text, details, category, hit_count,
          embedding, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, $5::vector, $6, $6)
       ON CONFLICT (signature) DO UPDATE SET
         lesson_text = EXCLUDED.lesson_text,
         details     = COALESCE(EXCLUDED.details, build_memory.details),
         category    = COALESCE(EXCLUDED.category, build_memory.category),
         hit_count   = build_memory.hit_count + 1,
         embedding   = COALESCE(EXCLUDED.embedding, build_memory.embedding),
         updated_at  = EXCLUDED.updated_at
       RETURNING id`,
      [
        signature,
        text,
        details ? JSON.stringify(details) : null,
        category,
        embedding ? toPgVector(embedding) : null,
        now,
      ],
    );
    return rows[0]?.id || null;
  } catch (e) {
    console.warn(`[memory] record failed: ${e.message}`);
    return null;
  }
}

// Backfill embeddings for rows that were recorded while embeddings were
// unavailable. Cheap to call on boot; bounded by `limit`.
async function backfillEmbeddings({ limit = 50 } = {}) {
  if (!llm.isEmbeddingConfigured()) return 0;
  let done = 0;
  try {
    const { rows } = await pool.query(
      `SELECT id, lesson_text FROM build_memory
         WHERE embedding IS NULL
         ORDER BY updated_at DESC
         LIMIT $1`,
      [limit],
    );
    for (const r of rows) {
      const vec = await llm.embed(r.lesson_text);
      if (!vec) continue;
      try {
        await pool.query(
          `UPDATE build_memory SET embedding = $1::vector WHERE id = $2`,
          [toPgVector(vec), r.id],
        );
        done += 1;
      } catch (e) {
        console.warn(`[memory] backfill update failed: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`[memory] backfill query failed: ${e.message}`);
  }
  return done;
}

// Find the K closest lessons to the query text. Returns rows sorted by
// ascending cosine distance (smaller = more similar). `maxDistance`
// caps how unrelated a hit can be; default 0.45 is roughly "semantically
// loose match". Returns [] if embeddings aren't configured or the query
// can't be embedded.
async function findSimilar({ text, k = 8, maxDistance = 0.45, category = null }) {
  if (!text) return [];
  const vec = await llm.embed(text);
  if (!vec) return [];
  const pgVec = toPgVector(vec);
  try {
    const params = [pgVec, maxDistance, k];
    let sql = `SELECT id, signature, lesson_text, details, category, hit_count,
                      updated_at,
                      (embedding <=> $1::vector) AS distance
                 FROM build_memory
                WHERE embedding IS NOT NULL
                  AND (embedding <=> $1::vector) <= $2`;
    if (category) {
      sql += ` AND (category = $4 OR category IS NULL)`;
      params.push(category);
    }
    sql += `
                ORDER BY embedding <=> $1::vector
                LIMIT $3`;
    const { rows } = await pool.query(sql, params);
    return rows.map(rowToLesson);
  } catch (e) {
    console.warn(`[memory] findSimilar failed: ${e.message}`);
    return [];
  }
}

// Lookup by exact signature. Handy for dedup checks in tests / smoke runs.
async function getBySignature(signature) {
  try {
    const { rows } = await pool.query(
      `SELECT id, signature, lesson_text, details, category, hit_count,
              created_at, updated_at
         FROM build_memory WHERE signature = $1`,
      [signature],
    );
    return rows[0] ? rowToLesson(rows[0]) : null;
  } catch (e) {
    console.warn(`[memory] getBySignature failed: ${e.message}`);
    return null;
  }
}

// Cheap existence check by signature — returns true if a row already
// exists with this canonical text. The seeder uses this to skip the
// (paid) embedding call on re-runs.
async function existsBySignature(signature) {
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM build_memory WHERE signature = $1 LIMIT 1`,
      [signature],
    );
    return rows.length > 0;
  } catch (e) {
    console.warn(`[memory] existsBySignature failed: ${e.message}`);
    return false;
  }
}

// Top lessons for a category by hit_count (no embedding call). Used on
// the first build iteration to surface seeded image recipes even when
// the semantic query is vague.
async function topByCategory(category, limit = 3) {
  if (!category) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, signature, lesson_text, details, category, hit_count,
              created_at, updated_at
         FROM build_memory
        WHERE category = $1
        ORDER BY hit_count DESC, updated_at DESC
        LIMIT $2`,
      [category, limit],
    );
    return rows.map(rowToLesson);
  } catch (e) {
    console.warn(`[memory] topByCategory(${category}) failed: ${e.message}`);
    return [];
  }
}

// Hard delete by category — only used by the seeder's --force path. The
// regular failure/success recording flow should never call this.
async function removeByCategory(category) {
  if (!category) return 0;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM build_memory WHERE category = $1`,
      [category],
    );
    return rowCount || 0;
  } catch (e) {
    console.warn(`[memory] removeByCategory(${category}) failed: ${e.message}`);
    return 0;
  }
}

async function count() {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM build_memory`);
    return rows[0]?.n || 0;
  } catch (e) {
    console.warn(`[memory] count failed: ${e.message}`);
    return 0;
  }
}

function rowToLesson(r) {
  return {
    id: r.id,
    signature: r.signature,
    text: r.lesson_text,
    details: r.details,
    category: r.category,
    hitCount: r.hit_count,
    createdAt: r.created_at != null ? Number(r.created_at) : null,
    updatedAt: r.updated_at != null ? Number(r.updated_at) : null,
    distance: r.distance != null ? Number(r.distance) : null,
  };
}

module.exports = {
  record,
  findSimilar,
  topByCategory,
  getBySignature,
  existsBySignature,
  removeByCategory,
  count,
  backfillEmbeddings,
  sigOf,
};
