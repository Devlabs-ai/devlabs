'use strict';

import type { GameSession, SessionStatus } from '../types/domain';

const pool = require('./pool');
const redis = require('../cache/redis');

const sessions = new Map<string, GameSession>();

function makeSession({
  id,
  challengeId = null,
  candidateName = null,
  status = 'pending',
}: {
  id: string;
  challengeId?: string | null;
  candidateName?: string | null;
  status?: SessionStatus;
}): GameSession {
  return {
    id,
    status,
    startTime: Date.now(),
    endTime: null,
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

function get(id: string): GameSession | null {
  return sessions.get(id) || null;
}

function set(id: string, session: GameSession): GameSession {
  sessions.set(id, session);
  return session;
}

function remove(id: string): void {
  sessions.delete(id);
}

function all(): GameSession[] {
  return Array.from(sessions.values());
}

async function persistRow(session: GameSession): Promise<void> {
  const sql = `
    INSERT INTO game_sessions
      (id, challenge_id, status, candidate_name, start_time, end_time, recovered, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (id) DO UPDATE SET
      challenge_id   = EXCLUDED.challenge_id,
      status         = EXCLUDED.status,
      candidate_name = EXCLUDED.candidate_name,
      start_time     = EXCLUDED.start_time,
      end_time       = EXCLUDED.end_time,
      recovered      = EXCLUDED.recovered
  `;
  await pool.query(sql, [
    session.id,
    session.challengeId,
    session.status,
    session.candidateName,
    session.startTime,
    session.endTime,
    session.recovered,
    session.startTime,
  ]);
}

async function persistRuntime(session: GameSession): Promise<void> {
  await redis.setRuntime(session.id, session);
  await persistRow(session);
}

async function restoreFromDB(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, challenge_id, status, candidate_name, start_time, end_time, recovered
       FROM game_sessions
      WHERE status IN ('pending', 'active')`,
  );

  for (const row of rows) {
    let runtime: GameSession | null = null;
    try {
      runtime = await redis.getRuntime(row.id);
    } catch (e: unknown) {
      console.warn(`[sessionStore] redis runtime fetch failed for ${row.id}:`, (e as Error).message);
    }

    const session: GameSession = runtime || makeSession({
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
  restoreFromDB,
};
