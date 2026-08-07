'use strict';

import type { GameSession } from '../types/domain';

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const sessionStore = require('../db/sessionStore');
const workspaceStore = require('./workspaceStore');

interface StartSparkOpts {
  challengeId: string;
  userId?: string | null;
  candidateName?: string | null;
  entrypoint?: string;
  starterFiles: Record<string, string>;
}

export type StartSparkResult = {
  session: GameSession;
  created: boolean;
};

async function findExistingSparkSession(
  challengeId: string,
  owner: string,
): Promise<(GameSession & Record<string, unknown>) | null> {
  const mem = sessionStore
    .all()
    .find(
      (s: GameSession & Record<string, unknown>) =>
        s.runtime === 'spark-platform'
        && s.challengeId === challengeId
        && workspaceStore.sanitizeOwner(String(s.userId || '')) === owner,
    ) as (GameSession & Record<string, unknown>) | undefined;
  if (mem) return mem;

  const { rows } = await pool.query(
    `SELECT id, challenge_id, status, candidate_name, start_time, end_time, recovered,
            runtime, user_id, workspace_prefix, entrypoint, workspace_updated_at
       FROM sessions
      WHERE runtime = 'spark-platform'
        AND challenge_id = $1
        AND user_id = $2
      ORDER BY start_time ASC, id ASC
      LIMIT 1`,
    [challengeId, owner],
  );
  if (!rows[0]) return null;

  const row = rows[0];
  const session = sessionStore.makeSession({
    id: row.id,
    challengeId: row.challenge_id,
    candidateName: row.candidate_name,
    status: row.status,
  }) as GameSession & Record<string, unknown>;

  session.startTime = Number(row.start_time) || session.startTime;
  session.endTime = row.end_time ? Number(row.end_time) : null;
  session.recovered = !!row.recovered;
  session.runtime = 'spark-platform';
  session.userId = row.user_id;
  session.workspacePrefix = row.workspace_prefix;
  session.entrypoint = row.entrypoint;
  session.workspaceUpdatedAt = row.workspace_updated_at
    ? Number(row.workspace_updated_at)
    : null;
  session.buildDir = null;
  session.portMap = null;
  session.services = [];
  session.terminalService = null;

  sessionStore.set(session.id, session);
  return session;
}

async function startSparkSession({
  challengeId,
  userId = null,
  candidateName = null,
  entrypoint = 'src/main.py',
  starterFiles,
}: StartSparkOpts): Promise<StartSparkResult> {
  if (!challengeId) {
    const e = new Error('challengeId is required');
    (e as Error & { status?: number }).status = 400;
    throw e;
  }
  if (!starterFiles || typeof starterFiles !== 'object') {
    const e = new Error('starterFiles map is required');
    (e as Error & { status?: number }).status = 400;
    throw e;
  }

  const owner = workspaceStore.sanitizeOwner(userId || candidateName || 'anonymous');
  const workspacePrefix = workspaceStore.buildWorkspacePrefix(challengeId, owner);

  const existing = await findExistingSparkSession(challengeId, owner);
  if (existing) {
    existing.status = 'active';
    existing.endTime = null;
    existing.runtime = 'spark-platform';
    existing.userId = owner;
    existing.workspacePrefix = workspacePrefix;
    existing.entrypoint = entrypoint || existing.entrypoint || 'src/main.py';
    existing.candidateName = candidateName || existing.candidateName;
    sessionStore.set(existing.id, existing);

    try {
      await workspaceStore.seedMissingFiles(existing.id, workspacePrefix, starterFiles);
      // Ensure DB index matches object store after prefix consolidation.
      const files = await workspaceStore.loadAllFiles(existing.id, workspacePrefix);
      if (Object.keys(files).length === 0) {
        await workspaceStore.seedFiles(existing.id, workspacePrefix, starterFiles);
      }
    } catch (err: unknown) {
      throw wrapSeedError(err);
    }

    await sessionStore.persistRow(existing);
    return { session: existing, created: false };
  }

  const sessionId = uuidv4();
  const session = sessionStore.makeSession({
    id: sessionId,
    challengeId,
    candidateName,
    status: 'active',
  }) as GameSession & Record<string, unknown>;

  session.runtime = 'spark-platform';
  session.userId = owner;
  session.workspacePrefix = workspacePrefix;
  session.entrypoint = entrypoint;
  session.workspaceUpdatedAt = Date.now();
  session.buildDir = null;
  session.portMap = null;
  session.services = [];
  session.terminalService = null;

  sessionStore.set(sessionId, session);
  await sessionStore.persistRow(session);

  try {
    await workspaceStore.seedFiles(sessionId, workspacePrefix, starterFiles);
  } catch (err: unknown) {
    session.status = 'ended';
    session.endTime = Date.now();
    await sessionStore.persistRow(session).catch(() => {});
    sessionStore.remove(sessionId);
    // Best-effort: remove the row so a failed first open can retry create.
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]).catch(() => {});
    throw wrapSeedError(err);
  }

  return { session, created: true };
}

function wrapSeedError(err: unknown): Error {
  const codes: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    const e = cur as { code?: string; message?: string; cause?: unknown };
    if (e.code) codes.push(e.code);
    cur = e.cause;
  }
  const unreachable = codes.some((c) =>
    c === 'EHOSTUNREACH' || c === 'ECONNREFUSED' || c === 'ENOTFOUND' || c === 'ETIMEDOUT',
  );
  const msg = unreachable
    ? `MinIO unreachable (${codes.join('/') || 'network'}): check MINIO_ENDPOINT and network to the cluster`
    : ((err as Error).message || 'Failed to seed workspace in MinIO');
  const wrapped = new Error(msg) as Error & { status?: number; cause?: unknown };
  wrapped.status = 503;
  wrapped.cause = err;
  return wrapped;
}

async function endSparkSession(sessionId: string): Promise<GameSession> {
  const session = sessionStore.get(sessionId) as (GameSession & Record<string, unknown>) | null;
  if (!session) {
    const e = new Error('session not found');
    (e as Error & { status?: number }).status = 404;
    throw e;
  }
  // Keep workspace objects; reopen reuses the same session/prefix.
  session.status = 'ended';
  session.endTime = Date.now();
  await sessionStore.persistRow(session);
  return session;
}

module.exports = {
  startSparkSession,
  endSparkSession,
};
