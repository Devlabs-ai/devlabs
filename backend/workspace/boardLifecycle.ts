'use strict';

import type { BoardSpec, BoardState, ChallengeFull, GameSession } from '../types/domain';

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const sessionStore = require('../db/sessionStore');
const loader = require('../challenges/loader');
const { parseBoardSpec, gradeBoard, publicBoardSpec, emptyBoardState, coerceBoardState } = require('./boardGrade');
const { sanitizeOwner } = require('./workspaceStore');

function emptyState(spec: BoardSpec): BoardState {
  return emptyBoardState(spec);
}

function specFromChallenge(challenge: ChallengeFull | null): BoardSpec | null {
  if (!challenge) return null;
  return parseBoardSpec(challenge.boardSpec) || parseBoardSpec(challenge.sparkPlatform);
}

async function findExistingBoardSession(
  challengeId: string,
  owner: string,
): Promise<(GameSession & Record<string, unknown>) | null> {
  const mem = sessionStore
    .all()
    .find(
      (s: GameSession & Record<string, unknown>) =>
        s.runtime === 'board'
        && s.challengeId === challengeId
        && sanitizeOwner(String(s.userId || '')) === owner,
    ) as (GameSession & Record<string, unknown>) | undefined;
  if (mem) return mem;

  const { rows } = await pool.query(
    `SELECT id, challenge_id, status, candidate_name, start_time, end_time, recovered,
            runtime, user_id, workspace_prefix, entrypoint, workspace_updated_at, board_state
       FROM sessions
      WHERE runtime = 'board'
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
  session.runtime = 'board';
  session.userId = row.user_id;
  session.workspacePrefix = row.workspace_prefix;
  session.entrypoint = row.entrypoint;
  session.workspaceUpdatedAt = row.workspace_updated_at
    ? Number(row.workspace_updated_at)
    : null;
  session.boardState = row.board_state || null;
  session.buildDir = null;
  session.portMap = null;
  session.services = [];
  session.terminalService = null;

  sessionStore.set(session.id, session);
  return session;
}

async function startBoardSession({
  challengeId,
  userId = null,
  candidateName = null,
}: {
  challengeId: string;
  userId?: string | null;
  candidateName?: string | null;
}): Promise<{ session: GameSession; created: boolean; spec: BoardSpec }> {
  if (!challengeId) {
    const e = new Error('challengeId is required');
    (e as Error & { status?: number }).status = 400;
    throw e;
  }

  const challenge = loader.getChallenge(challengeId) as ChallengeFull | null;
  if (!challenge) {
    const e = new Error('challenge not found');
    (e as Error & { status?: number }).status = 404;
    throw e;
  }
  if ((challenge.sandboxType || '') !== 'board') {
    const e = new Error('not a board challenge');
    (e as Error & { status?: number }).status = 409;
    throw e;
  }
  const spec = specFromChallenge(challenge);
  if (!spec) {
    const e = new Error('board spec missing');
    (e as Error & { status?: number }).status = 500;
    throw e;
  }

  const owner = sanitizeOwner(userId || candidateName || 'anonymous');
  const existing = await findExistingBoardSession(challengeId, owner);
  if (existing) {
    existing.status = 'active';
    existing.endTime = null;
    existing.runtime = 'board';
    existing.userId = owner;
    existing.candidateName = candidateName || existing.candidateName;
    if (!existing.boardState) {
      existing.boardState = emptyState(spec);
    } else {
      existing.boardState = coerceBoardState(existing.boardState, spec);
    }
    sessionStore.set(existing.id, existing);
    await sessionStore.persistRow(existing);
    return { session: existing, created: false, spec };
  }

  const sessionId = uuidv4();
  const session = sessionStore.makeSession({
    id: sessionId,
    challengeId,
    candidateName,
    status: 'active',
  }) as GameSession & Record<string, unknown>;

  session.runtime = 'board';
  session.userId = owner;
  session.boardState = emptyState(spec);
  session.buildDir = null;
  session.portMap = null;
  session.services = [];
  session.terminalService = null;

  sessionStore.set(sessionId, session);
  await sessionStore.persistRow(session);
  return { session, created: true, spec };
}

function savePlaced(session: GameSession, spec: BoardSpec, bodyRaw: unknown): BoardState {
  const prev = coerceBoardState(session.boardState, spec);
  const incoming = coerceBoardState(
    {
      trayOrder: prev.trayOrder,
      fills: (bodyRaw && typeof bodyRaw === 'object' && !Array.isArray(bodyRaw)
        ? (bodyRaw as { fills?: unknown }).fills
        : null) ?? bodyRaw,
      lastGrade: prev.lastGrade,
    },
    spec,
  );
  const reset = Boolean(
    bodyRaw && typeof bodyRaw === 'object' && !Array.isArray(bodyRaw)
      && (bodyRaw as { reset?: unknown }).reset,
  );
  const next: BoardState = {
    trayOrder: prev.trayOrder?.length ? prev.trayOrder : spec.pieces.map((p) => p.id),
    fills: incoming.fills,
    nodes: [],
    edges: [],
    lastGrade: reset ? null : (prev.lastGrade ?? null),
  };
  session.boardState = next;
  session.workspaceUpdatedAt = Date.now();
  return next;
}

async function submitBoard(
  session: GameSession,
  spec: BoardSpec,
  bodyRaw: unknown,
): Promise<{ state: BoardState; grade: ReturnType<typeof gradeBoard> }> {
  const state = savePlaced(session, spec, bodyRaw);
  const grade = gradeBoard(spec, state);
  state.lastGrade = grade;
  session.boardState = state;
  session.workspaceUpdatedAt = Date.now();
  await sessionStore.persistRow(session);

  const jobId = uuidv4();
  const now = Date.now();
  await pool.query(
    `INSERT INTO submissions
       (id, session_id, challenge_id, user_id, mode, k8s_name, status,
        entrypoint, input_path, output_path, report_path, results_path, app_prefix,
        manifest_key, platform_job, error, logs, grade_status, grade_result, graded_at,
        submitted_at, updated_at, finished_at)
     VALUES ($1,$2,$3,$4,'submit',$5,'succeeded',$6,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$7,$8,$9,$10,$10,$10,$10)`,
    [
      jobId,
      session.id,
      session.challengeId,
      session.userId || null,
      `board-${jobId.slice(0, 8)}`,
      'board',
      JSON.stringify(['Board submitted', grade.summary]),
      grade.passed ? 'passed' : 'failed',
      JSON.stringify(grade),
      now,
    ],
  );

  return { state, grade };
}

async function endBoardSession(sessionId: string): Promise<GameSession> {
  const session = sessionStore.get(sessionId) as GameSession | null;
  if (!session) {
    const e = new Error('session not found');
    (e as Error & { status?: number }).status = 404;
    throw e;
  }
  session.status = 'ended';
  session.endTime = Date.now();
  await sessionStore.persistRow(session);
  return session;
}

module.exports = {
  startBoardSession,
  savePlaced,
  submitBoard,
  endBoardSession,
  specFromChallenge,
  publicBoardSpec,
  parseBoardSpec,
  coerceBoardState,
};
