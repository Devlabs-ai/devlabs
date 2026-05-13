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
];

async function runMigrations() {
  for (const sql of STATEMENTS) {
    await pool.query(sql);
  }
}

module.exports = { runMigrations };
