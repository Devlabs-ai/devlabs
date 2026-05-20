'use strict';

const pool = require('./pool');

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS invites (
     token         TEXT PRIMARY KEY,
     name          TEXT NOT NULL,
     challenge_id  TEXT,
     created_at    BIGINT NOT NULL,
     used          BOOLEAN NOT NULL DEFAULT false
   )`,
  `CREATE TABLE IF NOT EXISTS challenges (
     id                 TEXT PRIMARY KEY,
     title              TEXT NOT NULL,
     description        TEXT,
     difficulty         TEXT,
     tags               JSONB NOT NULL DEFAULT '[]'::jsonb,
     category           TEXT,
     finalized          BOOLEAN NOT NULL DEFAULT false,
     sandbox_type       TEXT,
     verified_dir       TEXT,
     problem_statement  JSONB,
     validation_spec    JSONB,
     created_at         BIGINT NOT NULL,
     updated_at         BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS game_sessions (
     id              TEXT PRIMARY KEY,
     challenge_id    TEXT,
     status          TEXT NOT NULL,
     candidate_name  TEXT,
     start_time      BIGINT,
     end_time        BIGINT,
     score           NUMERIC,
     recovered       BOOLEAN NOT NULL DEFAULT false,
     created_at      BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS session_events (
     id         BIGSERIAL PRIMARY KEY,
     session_id TEXT NOT NULL,
     type       TEXT NOT NULL,
     data       JSONB,
     ts         BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_session_events_session_id
     ON session_events (session_id)`,
  `CREATE TABLE IF NOT EXISTS draft_sessions (
     id          TEXT PRIMARY KEY,
     draft       JSONB,
     build_dir   TEXT,
     build_logs  JSONB,
     created_at  BIGINT NOT NULL,
     updated_at  BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS reviews (
     session_id        TEXT PRIMARY KEY,
     title             TEXT,
     built_challenge   JSONB,
     build_validation  JSONB,
     build_dir         TEXT,
     saved_at          BIGINT NOT NULL
   )`,
  // pgvector for semantic memory retrieval. Runs idempotently; on a stock
  // postgres image this will fail, which is why the infra compose now uses
  // the pgvector/pgvector:pg15 image.
  `CREATE EXTENSION IF NOT EXISTS vector`,
  // One-time cleanup: the previous "kind"-based build_lessons table has been
  // replaced by build_memory below. Safe to drop because dev DBs only ever
  // held smoke rows.
  `DROP TABLE IF EXISTS build_lessons`,
  `DROP TABLE IF EXISTS build_memory`,
  `CREATE TABLE IF NOT EXISTS specialists (
     id            SERIAL PRIMARY KEY,
     signature     TEXT NOT NULL UNIQUE,
     category      TEXT NOT NULL,
     stack         TEXT,
     service_role  TEXT,
     title         TEXT NOT NULL,
     dos           JSONB NOT NULL DEFAULT '[]',
     donts         JSONB NOT NULL DEFAULT '[]',
     conf          JSONB NOT NULL DEFAULT '{}',
     priority      INT NOT NULL DEFAULT 0,
     active        BOOLEAN NOT NULL DEFAULT true,
     created_at    BIGINT NOT NULL,
     updated_at    BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_specialists_category_active
     ON specialists (category, priority DESC)
     WHERE active = true`,
  `CREATE TABLE IF NOT EXISTS lessons (
     id               SERIAL PRIMARY KEY,
     phase            TEXT NOT NULL CHECK (phase IN ('start', 'validate')),
     draft_session_id TEXT,
     build_session_id TEXT NOT NULL,
     category         TEXT,
     title            TEXT,
     problem_context  TEXT NOT NULL,
     failure_summary  TEXT NOT NULL,
     fix_summary      TEXT NOT NULL,
     lesson_text      TEXT NOT NULL,
     details          JSONB,
     embedding        vector(1536),
     created_at       BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_lessons_phase_category
     ON lessons (phase, category)`,
  `CREATE INDEX IF NOT EXISTS idx_lessons_embedding
     ON lessons USING hnsw (embedding vector_cosine_ops)`,
];

async function runMigrations() {
  for (const sql of STATEMENTS) {
    await pool.query(sql);
  }
}

module.exports = { runMigrations };
