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
  `ALTER TABLE users DROP COLUMN IF EXISTS company_id`,
  `DROP INDEX IF EXISTS idx_users_company_id`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'learner'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS review_tracks JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_users_status ON users (status)`,
  `CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)`,
  // Backfill: legacy is_admin → role admin (only when still the default learner).
  `UPDATE users SET role = 'admin' WHERE is_admin = true AND role = 'learner'`,
  // Keep is_admin in sync with role for older callers.
  `UPDATE users SET is_admin = (role = 'admin')`,

  // Challenge audience: admin | reviewers | users (default admin-only until opened up).
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS visible_to TEXT NOT NULL DEFAULT 'admin'`,
  `ALTER TABLE challenges ALTER COLUMN visible_to SET DEFAULT 'admin'`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS visibility_notes TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS bounty INTEGER NOT NULL DEFAULT 10`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS tokens INTEGER NOT NULL DEFAULT 10`,
  // Prefer tokens; copy any legacy bounty values once.
  `UPDATE challenges SET tokens = bounty WHERE tokens = 10 AND bounty IS DISTINCT FROM 10`,
  `CREATE INDEX IF NOT EXISTS idx_challenges_visible_to ON challenges (visible_to)`,

  `CREATE TABLE IF NOT EXISTS challenge_reviews (
     id            TEXT PRIMARY KEY,
     challenge_id  TEXT NOT NULL,
     author_id     TEXT NOT NULL,
     author_email  TEXT,
     author_name   TEXT,
     body          TEXT NOT NULL,
     created_at    BIGINT NOT NULL,
     updated_at    BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_challenge_reviews_challenge
     ON challenge_reviews (challenge_id, created_at)`,

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
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS board_state JSONB`,
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

  // First time a learner opened a lab's solution; opening it before the first
  // passed submit halves that lab's tokens (see challenges/solutionViews).
  `CREATE TABLE IF NOT EXISTS solution_views (
     user_id       TEXT NOT NULL,
     challenge_id  TEXT NOT NULL,
     viewed_at     BIGINT NOT NULL,
     PRIMARY KEY (user_id, challenge_id)
   )`,

  // "Notify me" on coming-soon content (e.g. a Major); one row per user per item.
  `CREATE TABLE IF NOT EXISTS notify_requests (
     user_id     TEXT NOT NULL,
     item_kind   TEXT NOT NULL,
     item_id     TEXT NOT NULL,
     email       TEXT,
     created_at  BIGINT NOT NULL,
     PRIMARY KEY (user_id, item_kind, item_id)
   )`,

  // Pre-launch waitlist from the landing page; no account needed. One row per email.
  `CREATE TABLE IF NOT EXISTS waitlist_signups (
     email         TEXT PRIMARY KEY,
     role          TEXT NOT NULL,
     organization  TEXT,
     source        TEXT,
     created_at    BIGINT NOT NULL
   )`,

  // Paper of the Month: an admin picks a paper from the pool; the latest pick is current.
  `ALTER TABLE IF EXISTS weekly_paper_picks RENAME TO monthly_paper_picks`,
  `CREATE TABLE IF NOT EXISTS monthly_paper_picks (
     id          SERIAL PRIMARY KEY,
     paper_id    TEXT NOT NULL,
     picked_by   TEXT,
     picked_at   BIGINT NOT NULL
   )`,
  // One graded attempt per user per paper; tokens count toward the platform leaderboard.
  `CREATE TABLE IF NOT EXISTS paper_quiz_attempts (
     user_id     TEXT NOT NULL,
     paper_id    TEXT NOT NULL,
     answers     JSONB NOT NULL,
     correct     INTEGER NOT NULL,
     total       INTEGER NOT NULL,
     tokens      INTEGER NOT NULL,
     created_at  BIGINT NOT NULL,
     PRIMARY KEY (user_id, paper_id)
   )`,

  // Global catalog number across all platforms (1, 2, 3, …).
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS number INTEGER`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_challenges_number
     ON challenges (number)
     WHERE number IS NOT NULL`,

  // Razorpay subscriptions — one row per track subscription. Access lasts until
  // paid_until (ms); webhooks keep status / periods in sync.
  `CREATE TABLE IF NOT EXISTS subscriptions (
     id                        TEXT PRIMARY KEY,
     user_id                   TEXT NOT NULL,
     plan_id                   TEXT NOT NULL,
     razorpay_subscription_id  TEXT NOT NULL UNIQUE,
     razorpay_plan_id          TEXT NOT NULL,
     status                    TEXT NOT NULL,
     first_month_amount_paise  INTEGER NOT NULL,
     offer_percent             INTEGER NOT NULL DEFAULT 0,
     start_at                  BIGINT,
     current_start             BIGINT,
     current_end               BIGINT,
     paid_until                BIGINT,
     cancel_requested          BOOLEAN NOT NULL DEFAULT false,
     created_at                BIGINT NOT NULL,
     updated_at                BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id, created_at DESC)`,
  // One-time monthly passes (Razorpay Orders) share the table: kind = 'one_time'.
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'subscription'`,
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT`,
  `ALTER TABLE subscriptions ALTER COLUMN razorpay_subscription_id DROP NOT NULL`,
  `ALTER TABLE subscriptions ALTER COLUMN razorpay_plan_id DROP NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_order
     ON subscriptions (razorpay_order_id)
     WHERE razorpay_order_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS payments (
     id                        TEXT PRIMARY KEY,
     user_id                   TEXT NOT NULL,
     subscription_id           TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
     razorpay_payment_id       TEXT NOT NULL UNIQUE,
     razorpay_invoice_id       TEXT,
     amount_paise              INTEGER NOT NULL,
     currency                  TEXT NOT NULL,
     status                    TEXT NOT NULL,
     method                    TEXT,
     created_at                BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS billing_events (
     event_id     TEXT PRIMARY KEY,
     type         TEXT NOT NULL,
     payload      JSONB NOT NULL,
     received_at  BIGINT NOT NULL
   )`,
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

const REGISTRATION_OPEN_KEY = 'registration_open';
const PLATFORM_ADMIN_EMAIL = 'rithvikalkanti@gmail.com';
const PLATFORM_ADMIN_PASSWORD = 'ComingSoon2027';

async function seedAuthDefaults(): Promise<void> {
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [REGISTRATION_OPEN_KEY, 'true'],
  );

  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash(PLATFORM_ADMIN_PASSWORD, 10);
  const now = Date.now();
  const { v4: uuidv4 } = require('uuid');
  await pool.query(
    `INSERT INTO users (id, email, name, created_at, last_login_at, password_hash, status, is_admin, role, review_tracks)
     VALUES ($1, $2, $3, $4, $4, $5, 'active', true, 'admin', '[]'::jsonb)
     ON CONFLICT (email) DO UPDATE SET
       is_admin = true,
       role = 'admin',
       status = 'active',
       password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash)`,
    [uuidv4(), PLATFORM_ADMIN_EMAIL, 'Admin', now, passwordHash],
  );
  // Old seeded admin — keep row if present but no longer platform admin by email alone.
  await pool.query(
    `UPDATE users SET is_admin = false, role = 'learner'
      WHERE email = 'admin@devlabs.app'
        AND email <> $1`,
    [PLATFORM_ADMIN_EMAIL],
  );
  console.log('[migrate] platform admin + registration_open seeded');
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
  await seedAuthDefaults();
}

module.exports = { runMigrations };
