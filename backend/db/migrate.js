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
  // Role bucket (software-engineer / data-engineer / platform-engineer /
  // devops). Picked at "Push to verified" time so the candidate library can
  // group labs by hiring track. Nullable for legacy rows that predate bucketing.
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS bucket TEXT`,
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
  `DROP TABLE IF EXISTS specialists`,
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
  `CREATE TABLE IF NOT EXISTS catalogue (
     id              SERIAL PRIMARY KEY,
     category        TEXT NOT NULL UNIQUE,
     image           TEXT,
     image_hints     JSONB NOT NULL DEFAULT '[]'::jsonb,
     port            INT,
     dos             JSONB NOT NULL DEFAULT '[]'::jsonb,
     donts           JSONB NOT NULL DEFAULT '[]'::jsonb,
     conf            JSONB NOT NULL DEFAULT '{}'::jsonb,
     default_limits  JSONB,
     handbook_text   TEXT,
     metric_format   TEXT,
     observables     JSONB NOT NULL DEFAULT '[]'::jsonb,
     created_at      BIGINT NOT NULL,
     updated_at      BIGINT NOT NULL
   )`,
  // Add lesson type: 'fix' (phase failed then succeeded within a run) or
  // 'anti-pattern' (build exhausted all iterations without ever passing).
  `ALTER TABLE lessons ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'fix'
     CHECK (type IN ('fix', 'anti-pattern'))`,
  `CREATE INDEX IF NOT EXISTS idx_lessons_type ON lessons (phase, type)`,

  // -------------------------------------------------------------------------
  // Multi-tenant user / auth schema
  // -------------------------------------------------------------------------

  // Companies — one row per subscribing organisation
  `CREATE TABLE IF NOT EXISTS companies (
     id                  TEXT PRIMARY KEY,
     name                TEXT NOT NULL,
     domain              TEXT NOT NULL UNIQUE,
     plan                TEXT NOT NULL DEFAULT 'starter'
                           CHECK (plan IN ('starter', 'pro', 'enterprise')),
     subscription_end    BIGINT,
     is_active           BOOLEAN NOT NULL DEFAULT true,
     created_at          BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies (domain)`,

  // Users — belong to a company; role scopes their capabilities
  `CREATE TABLE IF NOT EXISTS users (
     id            TEXT PRIMARY KEY,
     email         TEXT NOT NULL UNIQUE,
     company_id    TEXT NOT NULL REFERENCES companies(id),
     role          TEXT NOT NULL DEFAULT 'interviewer'
                     CHECK (role IN ('interviewer', 'admin')),
     name          TEXT,
     created_at    BIGINT NOT NULL,
     last_login_at BIGINT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_users_email      ON users (email)`,
  `CREATE INDEX IF NOT EXISTS idx_users_company_id ON users (company_id)`,

  // Libraries — one private library per company + one global public library
  // (company_id IS NULL = public)
  `CREATE TABLE IF NOT EXISTS libraries (
     id          TEXT PRIMARY KEY,
     company_id  TEXT REFERENCES companies(id),
     name        TEXT NOT NULL,
     created_at  BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_libraries_company ON libraries (company_id)`,

  // Extend challenges with authorship and library membership
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS authored_by  TEXT REFERENCES users(id)`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS library_id   TEXT REFERENCES libraries(id)`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS visibility   TEXT NOT NULL DEFAULT 'private'
     CHECK (visibility IN ('private', 'public'))`,

  // Authorship on authoring draft sessions
  `ALTER TABLE draft_sessions ADD COLUMN IF NOT EXISTS authored_by TEXT REFERENCES users(id)`,
  `CREATE INDEX IF NOT EXISTS idx_draft_sessions_authored_by ON draft_sessions (authored_by)`,

  // Backfill existing rows to the dev admin user when present
  `UPDATE challenges SET authored_by = (SELECT id FROM users WHERE email = 'admin@devlabs.app' LIMIT 1)
     WHERE authored_by IS NULL
       AND EXISTS (SELECT 1 FROM users WHERE email = 'admin@devlabs.app')`,
  `UPDATE draft_sessions SET authored_by = (SELECT id FROM users WHERE email = 'admin@devlabs.app' LIMIT 1)
     WHERE authored_by IS NULL
       AND EXISTS (SELECT 1 FROM users WHERE email = 'admin@devlabs.app')`,

  `ALTER TABLE invites ADD COLUMN IF NOT EXISTS candidate_email TEXT`,
  `ALTER TABLE invites ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id)`,
  `ALTER TABLE invites ADD COLUMN IF NOT EXISTS expires_at BIGINT`,
  `CREATE INDEX IF NOT EXISTS idx_invites_created_by ON invites (created_by)`,
  `UPDATE invites SET expires_at = created_at + 86400000 WHERE expires_at IS NULL`,

  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS idx_challenges_archived ON challenges (archived)`,

  `CREATE TABLE IF NOT EXISTS app_meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  // Remove draft sessions already shipped to Play (built challenge promoted, not in review queue)
  `DELETE FROM draft_sessions ds
     WHERE ds.build_dir IS NULL
       AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.session_id = ds.id)
       AND (ds.build_logs->>'builtChallenge') IS NOT NULL
       AND COALESCE(ds.build_logs->>'buildStatus', '') NOT IN ('building', 'review_ready', 'failed')`,
];

async function runMigrations() {
  for (const sql of STATEMENTS) {
    await pool.query(sql);
  }
}

module.exports = { runMigrations };
