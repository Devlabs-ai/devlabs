'use strict';

const pool = require('./pool');

const STATEMENTS: string[] = [
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
  `CREATE TABLE IF NOT EXISTS sessions (
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
     phase            TEXT NOT NULL,
     draft_session_id TEXT,
     build_session_id TEXT NOT NULL,
     category         TEXT,
     title            TEXT,
     failure_summary  TEXT NOT NULL,
     fix_summary      TEXT NOT NULL,
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
  `UPDATE lessons SET phase = 'spin' WHERE phase = 'start'`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'lessons_phase_check'
     ) THEN
       ALTER TABLE lessons
         ADD CONSTRAINT lessons_phase_check CHECK (phase IN ('spin', 'validate'));
     END IF;
   END $$`,

  // Slim lessons schema: embed failure_summary only; drop legacy columns.
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'lessons' AND column_name = 'lesson_text'
     ) THEN
       UPDATE lessons SET failure_summary = lesson_text
       WHERE COALESCE(trim(failure_summary), '') = ''
         AND lesson_text IS NOT NULL AND trim(lesson_text) <> '';
       UPDATE lessons SET failure_summary = failure_summary || E'\\n\\n' || left(lesson_text, 2000)
       WHERE lesson_text IS NOT NULL AND trim(lesson_text) <> ''
         AND length(coalesce(failure_summary, '')) < 120
         AND failure_summary NOT LIKE '%' || left(lesson_text, 40) || '%';
       UPDATE lessons SET embedding = NULL;
     END IF;
   END $$`,
  `ALTER TABLE lessons DROP COLUMN IF EXISTS problem_context`,
  `ALTER TABLE lessons DROP COLUMN IF EXISTS lesson_text`,
  `ALTER TABLE lessons DROP COLUMN IF EXISTS details`,

  // -------------------------------------------------------------------------
  // Multi-tenant user / auth schema
  // -------------------------------------------------------------------------

  // Users — identity for Play / authoring
  `CREATE TABLE IF NOT EXISTS users (
     id            TEXT PRIMARY KEY,
     email         TEXT NOT NULL UNIQUE,
     name          TEXT,
     created_at    BIGINT NOT NULL,
     last_login_at BIGINT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)`,
  `ALTER TABLE users DROP COLUMN IF EXISTS role`,
  `ALTER TABLE users DROP COLUMN IF EXISTS company_id`,
  `DROP INDEX IF EXISTS idx_users_company_id`,

  // Authorship on authoring draft sessions only (Play catalog is flat)
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

  `UPDATE draft_sessions SET authored_by = (SELECT id FROM users WHERE email = 'admin@devlabs.app' LIMIT 1)
     WHERE authored_by IS NULL
       AND EXISTS (SELECT 1 FROM users WHERE email = 'admin@devlabs.app')`,

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
  `ALTER TABLE sessions DROP COLUMN IF EXISTS score`,

  // Spark-platform / S3 workspace sessions (latest-only file sync).
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS runtime TEXT`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS workspace_prefix TEXT`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS entrypoint TEXT`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS workspace_updated_at BIGINT`,
  `CREATE TABLE IF NOT EXISTS session_workspace_files (
     session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     path         TEXT NOT NULL,
     content_hash TEXT,
     size_bytes   INT NOT NULL DEFAULT 0,
     etag         TEXT,
     updated_at   BIGINT NOT NULL,
     PRIMARY KEY (session_id, path)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_session_workspace_files_session
     ON session_workspace_files (session_id)`,

  // Spark Run/Submit attempts (formerly spark_jobs).
  `CREATE TABLE IF NOT EXISTS submissions (
     id            TEXT PRIMARY KEY,
     session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     challenge_id  TEXT,
     user_id       TEXT,
     mode          TEXT NOT NULL,
     k8s_name      TEXT NOT NULL,
     status        TEXT NOT NULL,
     entrypoint    TEXT,
     input_path    TEXT,
     output_path   TEXT,
     report_path   TEXT,
     app_prefix    TEXT,
     manifest_key  TEXT,
     platform_job  JSONB,
     error         TEXT,
     logs          JSONB,
     submitted_at  BIGINT NOT NULL,
     finished_at   BIGINT,
     updated_at    BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_submissions_session
     ON submissions (session_id, submitted_at DESC)`,

  `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS results_path TEXT`,
  `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS grade_status TEXT`,
  `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS grade_result JSONB`,
  `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS graded_at BIGINT`,

  // Spark / platform metadata (paths, limits, gradeChecks, …).
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS platform_spec JSONB`,
];

const CATALOG_V2_KEY = 'challenges_catalog_v2';

async function migrateSparkJobsToSubmissions(): Promise<void> {
  const { rows } = await pool.query(`
    SELECT
      to_regclass('public.spark_jobs') IS NOT NULL AS has_old,
      to_regclass('public.submissions') IS NOT NULL AS has_new
  `);
  const { has_old: hasOld, has_new: hasNew } = rows[0] || {};
  if (!hasOld) return;

  if (!hasNew) {
    await pool.query(`ALTER TABLE spark_jobs RENAME TO submissions`);
    await pool.query(`ALTER INDEX IF EXISTS idx_spark_jobs_session RENAME TO idx_submissions_session`);
    console.log('[migrate] renamed spark_jobs → submissions');
    return;
  }

  await pool.query(`
    INSERT INTO submissions
    SELECT * FROM spark_jobs
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`DROP TABLE spark_jobs`);
  console.log('[migrate] copied spark_jobs → submissions and dropped spark_jobs');
}

async function cutoverChallengesCatalog(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS challenges_legacy (
      LIKE challenges INCLUDING ALL
    )
  `);
  await pool.query(`ALTER TABLE challenges_legacy ADD COLUMN IF NOT EXISTS archived_at BIGINT`);

  const { rows } = await pool.query(`SELECT 1 FROM app_meta WHERE key = $1`, [CATALOG_V2_KEY]);
  if (rows.length > 0) return;

  const now = Date.now();
  // Snapshot current catalog (compose labs, etc.) then wipe for manual redesign.
  await pool.query(
    `
    INSERT INTO challenges_legacy
    SELECT c.*, $1::bigint AS archived_at
      FROM challenges c
    ON CONFLICT (id) DO NOTHING
    `,
    [now],
  );
  await pool.query(`TRUNCATE TABLE challenges`);
  await pool.query(`INSERT INTO app_meta (key, value) VALUES ($1, $2)`, [
    CATALOG_V2_KEY,
    String(now),
  ]);
  console.log('[migrate] archived challenges → challenges_legacy; cleared challenges');
}

/** Drop multi-tenant companies (and leftover users.company_id). */
async function dropCompaniesTable(): Promise<void> {
  await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS company_id`).catch(() => {});
  await pool.query(`DROP INDEX IF EXISTS idx_users_company_id`).catch(() => {});
  await pool.query(`DROP TABLE IF EXISTS companies CASCADE`);
  console.log('[migrate] companies / users.company_id dropped');
}

async function dropBuildCodeChunks(): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS build_code_chunks CASCADE`);
  console.log('[migrate] build_code_chunks dropped');
}

async function renameGameSessionsToSessions(): Promise<void> {
  const { rows } = await pool.query(`
    SELECT
      to_regclass('public.game_sessions') IS NOT NULL AS has_old,
      to_regclass('public.sessions') IS NOT NULL AS has_new
  `);
  const { has_old: hasOld, has_new: hasNew } = rows[0] || {};
  if (hasOld && !hasNew) {
    await pool.query(`ALTER TABLE game_sessions RENAME TO sessions`);
    await pool.query(
      `ALTER INDEX IF EXISTS idx_game_sessions_spark_user_challenge RENAME TO idx_sessions_spark_user_challenge`,
    );
    console.log('[migrate] renamed game_sessions → sessions');
  } else if (hasOld && hasNew) {
    // Prefer sessions; drop leftover legacy table after copying nothing (sessions is source of truth).
    await pool.query(`DROP TABLE IF EXISTS game_sessions CASCADE`);
    console.log('[migrate] dropped leftover game_sessions (sessions already exists)');
  }
}

const SESSIONS_CLEARED_KEY = 'sessions_cleared_v1';

async function clearSessionsTable(): Promise<void> {
  const { rows } = await pool.query(`SELECT 1 FROM app_meta WHERE key = $1`, [SESSIONS_CLEARED_KEY]);
  if (rows.length > 0) return;
  if (!(await pool.query(`SELECT to_regclass('public.sessions') IS NOT NULL AS ok`)).rows[0]?.ok) {
    return;
  }
  // Wipe Play attempts and dependents (FK cascade + explicit for orphans).
  await pool.query(`TRUNCATE TABLE sessions CASCADE`);
  await pool.query(`TRUNCATE TABLE session_workspace_files`).catch(() => {});
  await pool.query(`TRUNCATE TABLE submissions`).catch(() => {});
  await pool.query(`INSERT INTO app_meta (key, value) VALUES ($1, $2)`, [
    SESSIONS_CLEARED_KEY,
    String(Date.now()),
  ]);
  console.log('[migrate] truncated sessions (+ submissions / workspace files)');
}

async function dropInvitesTable(): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS invites CASCADE`);
  console.log('[migrate] invites table dropped');
}

async function dropLibrariesTable(): Promise<void> {
  await pool.query(`ALTER TABLE challenges DROP COLUMN IF EXISTS library_id`).catch(() => {});
  await pool.query(`DROP TABLE IF EXISTS libraries CASCADE`);
  console.log('[migrate] libraries table dropped');
}

/** Drop Play library grouping columns (my/org/public/archive + role buckets). */
async function dropChallengeLibraryColumns(): Promise<void> {
  await pool.query(`DROP INDEX IF EXISTS idx_challenges_archived`).catch(() => {});
  for (const col of ['bucket', 'archived', 'visibility', 'authored_by', 'library_id']) {
    await pool.query(`ALTER TABLE challenges DROP COLUMN IF EXISTS ${col}`).catch(() => {});
  }
  console.log('[migrate] challenges library columns dropped (bucket/archived/visibility/authored_by)');
}

async function runMigrations(): Promise<void> {
  await renameGameSessionsToSessions();
  for (const sql of STATEMENTS) {
    await pool.query(sql);
  }
  await migrateSparkJobsToSubmissions();
  await cutoverChallengesCatalog();
  await dropCompaniesTable();
  await dropBuildCodeChunks();
  await dropInvitesTable();
  await dropLibrariesTable();
  await dropChallengeLibraryColumns();
  await clearSessionsTable();
}

module.exports = { runMigrations };
