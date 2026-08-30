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

  // -------------------------------------------------------------------------
  // Multi-tenant user / auth schema
  // -------------------------------------------------------------------------

  // Users — identity for Play
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

  `CREATE TABLE IF NOT EXISTS app_meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

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
  // Spark History–derived timings (jobs wall, excludes image pull / pod setup).
  `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS run_metrics JSONB`,
  `CREATE INDEX IF NOT EXISTS idx_submissions_user_solved
     ON submissions (user_id, challenge_id)
     WHERE mode = 'submit' AND grade_status = 'passed'`,

  // Spark / platform metadata (paths, limits, gradeChecks, …).
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS platform_spec JSONB`,

  // Global catalog number across all platforms (1, 2, 3, …).
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS number INTEGER`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_challenges_number
     ON challenges (number)
     WHERE number IS NOT NULL`,
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

/** v0.2: authoring/review removed — drop draft, review, catalogue, lesson tables. */
async function dropAuthoringTables(): Promise<void> {
  for (const table of [
    'draft_session_meta',
    'draft_sessions',
    'reviews',
    'lessons',
    'catalogue',
  ]) {
    await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`).catch(() => {});
  }
  console.log('[migrate] authoring/review tables dropped (drafts/reviews/lessons/catalogue)');
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
  await dropAuthoringTables();
  await clearSessionsTable();
}

module.exports = { runMigrations };
