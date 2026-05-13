'use strict';

const pool = require('./pool');
const redis = require('../cache/redis');

const sessions = new Map();

function makeSession({
  id,
  challengeId = null,
  candidateName = null,
  status = 'pending',
}) {
  return {
    id,
    status,
    startTime: Date.now(),
    endTime: null,
    score: null,
    containerIds: [],
    networkId: null,
    ports: null,
    recovered: false,
    recoveryCounter: 0,
    candidateName,
    challengeId,
    buildDir: null,
    portMap: null,
    metricsService: null,
    terminalService: null,
    services: [],
    commandHistory: [],
  };
}

function get(id) {
  return sessions.get(id) || null;
}

function set(id, session) {
  sessions.set(id, session);
  return session;
}

function remove(id) {
  sessions.delete(id);
}

function all() {
  return Array.from(sessions.values());
}

async function persistRow(session) {
  const sql = `
    INSERT INTO game_sessions
      (id, challenge_id, status, candidate_name, start_time, end_time, score, recovered, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (id) DO UPDATE SET
      challenge_id   = EXCLUDED.challenge_id,
      status         = EXCLUDED.status,
      candidate_name = EXCLUDED.candidate_name,
      start_time     = EXCLUDED.start_time,
      end_time       = EXCLUDED.end_time,
      score          = EXCLUDED.score,
      recovered      = EXCLUDED.recovered
  `;
  await pool.query(sql, [
    session.id,
    session.challengeId,
    session.status,
    session.candidateName,
    session.startTime,
    session.endTime,
    session.score,
    session.recovered,
    session.startTime,
  ]);
}

async function persistEvent(sessionId, type, data) {
  await pool.query(
    `INSERT INTO session_events (session_id, type, data, ts) VALUES ($1,$2,$3,$4)`,
    [sessionId, type, data || null, Date.now()],
  );
}

async function loadEvents(sessionId) {
  const { rows } = await pool.query(
    `SELECT type, data, ts FROM session_events WHERE session_id=$1 ORDER BY id ASC`,
    [sessionId],
  );
  return rows;
}

async function persistRuntime(session) {
  await redis.setRuntime(session.id, session);
  await persistRow(session);
}

async function restoreFromDB() {
  const { rows } = await pool.query(
    `SELECT id, challenge_id, status, candidate_name, start_time, end_time, score, recovered
       FROM game_sessions
      WHERE status IN ('pending', 'active')`,
  );

  for (const row of rows) {
    let runtime = null;
    try {
      runtime = await redis.getRuntime(row.id);
    } catch (e) {
      console.warn(`[sessionStore] redis runtime fetch failed for ${row.id}:`, e.message);
    }

    const session = runtime || makeSession({
      id: row.id,
      challengeId: row.challenge_id,
      candidateName: row.candidate_name,
      status: row.status,
    });

    session.id = row.id;
    session.challengeId = row.challenge_id;
    session.status = row.status;
    session.candidateName = row.candidate_name;
    session.startTime = Number(row.start_time) || session.startTime;
    session.endTime = row.end_time ? Number(row.end_time) : session.endTime;
    session.score = row.score != null ? Number(row.score) : session.score;
    session.recovered = !!row.recovered;

    sessions.set(row.id, session);
  }

  console.log(`[sessionStore] restored ${sessions.size} sessions`);
}

module.exports = {
  makeSession,
  get,
  set,
  remove,
  all,
  persistRow,
  persistRuntime,
  persistEvent,
  loadEvents,
  restoreFromDB,
};
