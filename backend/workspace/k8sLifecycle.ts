'use strict';

import type { GameSession } from '../types/domain';

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const sessionStore = require('../db/sessionStore');
const workspaceStore = require('./workspaceStore');
const loader = require('../challenges/loader');
const k8s = require('./k8sCluster');

interface StartK8sOpts {
  challengeId: string;
  userId?: string | null;
  candidateName?: string | null;
  /** Human-readable slug for ns-<user-name> (email local-part, display name, etc.). */
  userName?: string | null;
}

export type StartK8sResult = {
  session: GameSession;
  created: boolean;
  provisioned: boolean;
};

function platformSpecOf(challengeId: string): {
  quota?: { pods?: string; cpu?: string; memory?: string };
  setup?: { script?: string };
  grade?: { script?: string; timeoutSeconds?: number };
} {
  const c = loader.getChallenge(challengeId) as {
    k8sPlatform?: {
      quota?: { pods?: string; cpu?: string; memory?: string };
      setup?: { script?: string };
      grade?: { script?: string; timeoutSeconds?: number };
    };
  } | null;
  return c?.k8sPlatform || {};
}

async function findExistingK8sSession(
  challengeId: string,
  owner: string,
): Promise<(GameSession & Record<string, unknown>) | null> {
  const mem = sessionStore
    .all()
    .find(
      (s: GameSession & Record<string, unknown>) =>
        s.runtime === 'kubernetes'
        && s.challengeId === challengeId
        && workspaceStore.sanitizeOwner(String(s.userId || '')) === owner,
    ) as (GameSession & Record<string, unknown>) | undefined;
  if (mem) return mem;

  const { rows } = await pool.query(
    `SELECT id, challenge_id, status, candidate_name, start_time, end_time, recovered,
            runtime, user_id, workspace_prefix, entrypoint, workspace_updated_at
       FROM sessions
      WHERE runtime = 'kubernetes'
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
  session.runtime = 'kubernetes';
  session.userId = row.user_id;
  session.k8sNamespace = row.workspace_prefix;
  session.workspacePrefix = row.workspace_prefix;
  session.buildDir = null;
  session.portMap = null;
  session.services = [];
  session.terminalService = null;

  sessionStore.set(session.id, session);
  return session;
}

async function ensureProvisioned(
  ns: string,
  challengeId: string,
  forceSetup: boolean,
): Promise<boolean> {
  const spec = platformSpecOf(challengeId);
  await k8s.ensureLearnerNamespace(ns, spec.quota || {});

  const already = await k8s.hasChallengeSetup(ns, challengeId);
  if (already && !forceSetup) return false;

  if (forceSetup) {
    await k8s.wipeChallengeResources(ns, challengeId);
  }

  const script = spec.setup?.script || 'setup.sh';
  const result = await k8s.runChallengeScript(ns, challengeId, script);
  if (result.code !== 0) {
    const msg = (result.stderr || result.stdout || 'setup failed').trim();
    throw Object.assign(new Error(`Lab setup failed: ${msg}`), { status: 502 });
  }
  await k8s.markChallengeSetup(ns, challengeId);
  return true;
}

async function startK8sSession({
  challengeId,
  userId = null,
  candidateName = null,
  userName = null,
}: StartK8sOpts): Promise<StartK8sResult> {
  if (!challengeId) {
    throw Object.assign(new Error('challengeId is required'), { status: 400 });
  }

  const listed = loader.getChallenge(challengeId);
  if (!listed) {
    throw Object.assign(new Error('challenge not found'), { status: 404 });
  }
  if ((listed.sandboxType || '') !== 'kubernetes') {
    throw Object.assign(new Error('not a kubernetes lab'), { status: 400 });
  }

  const owner = workspaceStore.sanitizeOwner(userId || candidateName || 'anonymous');
  const ns = k8s.learnerNamespace(userName || candidateName || owner);

  const existing = await findExistingK8sSession(challengeId, owner);
  if (existing) {
    existing.status = 'active';
    existing.endTime = null;
    existing.runtime = 'kubernetes';
    existing.userId = owner;
    existing.k8sNamespace = ns;
    existing.workspacePrefix = ns;
    existing.candidateName = candidateName || existing.candidateName;
    sessionStore.set(existing.id, existing);

    const provisioned = await ensureProvisioned(ns, challengeId, false);
    await sessionStore.persistRow(existing);
    return { session: existing, created: false, provisioned };
  }

  const sessionId = uuidv4();
  const session = sessionStore.makeSession({
    id: sessionId,
    challengeId,
    candidateName,
    status: 'active',
  }) as GameSession & Record<string, unknown>;

  session.runtime = 'kubernetes';
  session.userId = owner;
  session.k8sNamespace = ns;
  session.workspacePrefix = ns;
  session.buildDir = null;
  session.portMap = null;
  session.services = [];
  session.terminalService = null;

  sessionStore.set(sessionId, session);
  await sessionStore.persistRow(session);

  try {
    const provisioned = await ensureProvisioned(ns, challengeId, false);
    return { session, created: true, provisioned };
  } catch (err) {
    session.status = 'ended';
    session.endTime = Date.now();
    await sessionStore.persistRow(session).catch(() => {});
    sessionStore.remove(sessionId);
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]).catch(() => {});
    throw err;
  }
}

async function resetK8sSession(sessionId: string): Promise<GameSession> {
  const session = sessionStore.get(sessionId) as (GameSession & { k8sNamespace?: string }) | null;
  if (!session || session.runtime !== 'kubernetes') {
    throw Object.assign(new Error('not a kubernetes session'), { status: 409 });
  }
  const ns = session.k8sNamespace || session.workspacePrefix;
  const challengeId = session.challengeId;
  if (!ns || !challengeId) {
    throw Object.assign(new Error('session missing namespace'), { status: 409 });
  }
  await ensureProvisioned(ns, challengeId, true);
  session.status = 'active';
  session.endTime = null;
  await sessionStore.persistRow(session);
  return session;
}

async function endK8sSession(sessionId: string): Promise<GameSession> {
  const session = sessionStore.get(sessionId);
  if (!session) {
    throw Object.assign(new Error('session not found'), { status: 404 });
  }
  session.status = 'ended';
  session.endTime = Date.now();
  await sessionStore.persistRow(session);
  // Keep namespace contents so unfinished labs can resume.
  return session;
}

module.exports = {
  startK8sSession,
  resetK8sSession,
  endK8sSession,
  findExistingK8sSession,
};
