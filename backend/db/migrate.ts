'use strict';

const pool = require('./pool');

const STATEMENTS: string[] = [
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
     recovered       BOOLEAN NOT NULL DEFAULT false,
     created_at      BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS draft_sessions (
     id          TEXT PRIMARY KEY,
     draft       JSONB,
     build_dir   TEXT,
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
     phase            TEXT NOT NULL CHECK (phase IN ('spin', 'validate')),
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
  // Lesson type column (fix vs anti-pattern) removed — only successful phase recoveries are stored.
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'lessons' AND column_name = 'type'
     ) THEN
       DELETE FROM lessons WHERE type = 'anti-pattern';
     END IF;
   END $$`,
  `DROP INDEX IF EXISTS idx_lessons_type`,
  `ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_type_check`,
  `ALTER TABLE lessons DROP COLUMN IF EXISTS type`,
  // Rename legacy `start` phase label to `spin` (same pipeline phase as SPIN).
  `ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_phase_check`,
  `UPDATE lessons SET phase = 'spin' WHERE phase = 'start'`,
  `ALTER TABLE lessons ADD CONSTRAINT lessons_phase_check CHECK (phase IN ('spin', 'validate'))`,

  // Persistent per-draft code chunks for semantic search during CODE repair
  // and future work on the same challenge draft.
  `CREATE TABLE IF NOT EXISTS build_code_chunks (
     id               SERIAL PRIMARY KEY,
     draft_session_id TEXT,
     build_session_id TEXT NOT NULL,
     attempt          INT NOT NULL,
     path             TEXT NOT NULL,
     chunk_index      INT NOT NULL DEFAULT 0,
     content          TEXT NOT NULL,
     content_hash     TEXT NOT NULL,
     embedding        vector(1536),
     created_at       BIGINT NOT NULL
   )`,
  `ALTER TABLE build_code_chunks ADD COLUMN IF NOT EXISTS draft_session_id TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_build_code_chunks_session
     ON build_code_chunks (build_session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_build_code_chunks_draft
     ON build_code_chunks (draft_session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_build_code_chunks_embedding
     ON build_code_chunks USING hnsw (embedding vector_cosine_ops)`,

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

  // Build pipeline state — first-class columns (retry/resume + status). Previously buried in build_logs JSONB.
  `ALTER TABLE draft_sessions ADD COLUMN IF NOT EXISTS build_status TEXT`,
  `ALTER TABLE draft_sessions ADD COLUMN IF NOT EXISTS build_session_id TEXT`,
  `ALTER TABLE draft_sessions ADD COLUMN IF NOT EXISTS build_failed_dir TEXT`,
  `ALTER TABLE draft_sessions ADD COLUMN IF NOT EXISTS build_failed_session_id TEXT`,
  `ALTER TABLE draft_sessions ADD COLUMN IF NOT EXISTS build_failed_phase TEXT`,
  `ALTER TABLE draft_sessions ADD COLUMN IF NOT EXISTS build_failed_msg TEXT`,
  `ALTER TABLE draft_sessions ADD COLUMN IF NOT EXISTS build_current_phase TEXT`,
  `ALTER TABLE draft_sessions ADD COLUMN IF NOT EXISTS build_current_attempt INT NOT NULL DEFAULT 0`,
  `ALTER TABLE draft_sessions ADD COLUMN IF NOT EXISTS build_attempts INT NOT NULL DEFAULT 0`,
  // One-time backfill from legacy build_logs JSONB (column removed after migration).
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'draft_sessions' AND column_name = 'build_logs'
     ) THEN
       UPDATE draft_sessions SET
         build_status = COALESCE(build_status, build_logs->>'buildStatus'),
         build_session_id = COALESCE(build_session_id, build_logs->>'buildSessionId'),
         build_failed_dir = COALESCE(build_failed_dir, build_logs->>'buildFailedDir'),
         build_failed_session_id = COALESCE(build_failed_session_id, build_logs->>'buildFailedSessionId'),
         build_failed_phase = COALESCE(build_failed_phase, build_logs->>'buildFailedPhase'),
         build_failed_msg = COALESCE(build_failed_msg, build_logs->>'buildFailedMsg'),
         build_current_phase = COALESCE(build_current_phase, build_logs->>'buildCurrentPhase'),
         build_current_attempt = COALESCE(NULLIF(build_current_attempt, 0),
           NULLIF((build_logs->>'buildCurrentAttempt')::int, 0), 0),
         build_attempts = COALESCE(NULLIF(build_attempts, 0),
           NULLIF((build_logs->>'buildAttempts')::int, 0), 0)
       WHERE build_logs IS NOT NULL;
     END IF;
   END $$`,

  // Authoring workflow state — shape chat, checklists, validation (was build_logs JSONB on draft_sessions).
  `CREATE TABLE IF NOT EXISTS draft_session_meta (
     session_id             TEXT PRIMARY KEY REFERENCES draft_sessions(id) ON DELETE CASCADE,
     messages               JSONB NOT NULL DEFAULT '[]'::jsonb,
     shape_phase            TEXT NOT NULL DEFAULT 'design',
     design_approved        BOOLEAN NOT NULL DEFAULT false,
     schema_materialized    BOOLEAN NOT NULL DEFAULT false,
     build_checklists       JSONB NOT NULL DEFAULT '[]'::jsonb,
     build_latest_checklist JSONB,
     built_challenge        JSONB,
     build_validation       JSONB,
     review_feedback        JSONB,
     pipeline_logs          JSONB NOT NULL DEFAULT '[]'::jsonb
   )`,
  `ALTER TABLE draft_session_meta ADD COLUMN IF NOT EXISTS pipeline_logs JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'draft_sessions' AND column_name = 'build_logs'
     ) THEN
       INSERT INTO draft_session_meta (
         session_id, messages, shape_phase, design_approved, schema_materialized,
         build_checklists, build_latest_checklist, built_challenge, build_validation, review_feedback,
         pipeline_logs
       )
       SELECT
         ds.id,
         COALESCE(ds.build_logs->'messages', '[]'::jsonb),
         CASE
           WHEN ds.build_logs->>'shapePhase' = 'description' THEN 'design'
           ELSE COALESCE(ds.build_logs->>'shapePhase', 'design')
         END,
         COALESCE(
           (ds.build_logs->>'designApproved')::boolean,
           (ds.build_logs->>'descriptionApproved')::boolean,
           false
         ),
         COALESCE((ds.build_logs->>'schemaMaterialized')::boolean, false),
         COALESCE(ds.build_logs->'buildChecklists', '[]'::jsonb),
         ds.build_logs->'buildLatestChecklist',
         ds.build_logs->'builtChallenge',
         ds.build_logs->'buildValidation',
         ds.build_logs->'reviewFeedback',
         COALESCE(ds.build_logs->'buildLogs', '[]'::jsonb)
       FROM draft_sessions ds
       WHERE ds.build_logs IS NOT NULL
       ON CONFLICT (session_id) DO UPDATE SET
         pipeline_logs = CASE
           WHEN draft_session_meta.pipeline_logs = '[]'::jsonb
             THEN COALESCE(EXCLUDED.pipeline_logs, '[]'::jsonb)
           ELSE draft_session_meta.pipeline_logs
         END;
     END IF;
   END $$`,
  `ALTER TABLE draft_sessions DROP COLUMN IF EXISTS build_logs`,

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
       AND EXISTS (
         SELECT 1 FROM draft_session_meta m
         WHERE m.session_id = ds.id AND m.built_challenge IS NOT NULL
       )
       AND COALESCE(ds.build_status, '') NOT IN ('building', 'review_ready', 'failed')`,

  // Play sessions: drop automated scoring artifacts (interviewer evaluates manually).
  `DROP TABLE IF EXISTS session_events`,
  `ALTER TABLE game_sessions DROP COLUMN IF EXISTS score`,
];

async function runMigrations(): Promise<void> {
  for (const sql of STATEMENTS) {
    await pool.query(sql);
  }
}

module.exports = { runMigrations };
