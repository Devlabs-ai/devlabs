'use strict';

import type { BoxFlavor, GameSession, K8sPlatformSpec } from '../types/domain';

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const sessionStore = require('../db/sessionStore');
const workspaceStore = require('./workspaceStore');
const loader = require('../challenges/loader');
const k8s = require('./k8sCluster');
const capacity = require('./k8sCapacity');
const linuxBox = require('./linuxBox');
const { isClusterLabType, boxFlavor } = require('../challenges/labTypes');

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

function platformSpecOf(challengeId: string): K8sPlatformSpec {
  const c = loader.getChallenge(challengeId) as { k8sPlatform?: K8sPlatformSpec } | null;
  return c?.k8sPlatform || {};
}

/** linux / docker for box labs (one machine per learner), null for namespace labs. */
function boxFlavorOf(challengeId: string): BoxFlavor | null {
  return boxFlavor(loader.getChallenge(challengeId)?.sandboxType);
}

/**
 * One learner namespace hosts every lab of that learner, so provision / reset /
 * park for it run strictly one at a time, whichever lab they belong to. Otherwise
 * an abandoned open's setup.sh or a closing lab's park can interleave with the
 * next lab and leak objects into (or wipe) it.
 */
const nsLocks = new Map<string, Promise<unknown>>();

function withNsLock<T>(ns: string, fn: () => Promise<T>): Promise<T> {
  const prev = nsLocks.get(ns) || Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  nsLocks.set(ns, tail);
  void tail.then(() => {
    if (nsLocks.get(ns) === tail) nsLocks.delete(ns);
  });
  return run;
}

/** ns → challenge whose park failed; its objects are still in the namespace. */
const unparked = new Map<string, string>();

async function park(ns: string, challengeId: string): Promise<void> {
  try {
    await k8s.parkChallengeNamespace(ns, challengeId);
    if (unparked.get(ns) === challengeId) unparked.delete(ns);
  } catch (err) {
    unparked.set(ns, challengeId);
    throw err;
  }
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

const LAB_ENV_UNAVAILABLE_MSG =
  'We could not prepare a clean lab environment right now. Something is down on our side. '
  + 'Please contact the administrator.';

function labEnvUnavailable(): Error {
  return Object.assign(new Error(LAB_ENV_UNAVAILABLE_MSG), {
    status: 503,
    code: 'LAB_ENV_UNAVAILABLE',
  });
}

const LAB_CAPACITY_DOWN_MSG =
  'The cluster that runs these labs is busy or offline right now, so your lab could not start. '
  + 'Please try again in a few minutes, and contact the administrator if it keeps happening.';

function labCapacityDown(): Error {
  return Object.assign(new Error(LAB_CAPACITY_DOWN_MSG), {
    status: 503,
    code: 'LAB_ENV_UNAVAILABLE',
  });
}

/** Setup failed because pods had no room (pool asleep or full), not because of a lab bug. */
const CAPACITY_FAILURE = /exceeded quota|Unschedulable|Insufficient (cpu|memory)|Too many pods/i;

/** Whether the challenge's node pool can run labs right now; the message is shown on a locked lab. */
async function labAvailability(challengeId: string): Promise<{ available: boolean; message: string | null }> {
  const flavor = boxFlavorOf(challengeId);
  const available = await capacity.poolUp(flavor ? linuxBox.poolFor(flavor) : undefined);
  return { available, message: available ? null : LAB_CAPACITY_DOWN_MSG };
}

async function requirePool(ns: string, challengeId: string, pool?: string): Promise<void> {
  if (await capacity.poolUp(pool)) return;
  console.warn(`[k8s] ${ns}: node pool ${pool || 'labs'} has no nodes and cannot add any, refusing to open ${challengeId}`);
  throw labCapacityDown();
}

function ensureProvisioned(ns: string, challengeId: string, forceSetup: boolean): Promise<boolean> {
  const flavor = boxFlavorOf(challengeId);
  if (flavor) {
    return withNsLock(ns, () => provisionBox(ns, challengeId, flavor));
  }
  return withNsLock(ns, () => provision(ns, challengeId, forceSetup));
}

/** Box labs never resume a machine: every open (and reset) is a fresh box + setup.sh. */
async function provisionBox(ns: string, challengeId: string, flavor: BoxFlavor): Promise<boolean> {
  const spec = platformSpecOf(challengeId);
  await requirePool(ns, challengeId, linuxBox.poolFor(flavor));
  try {
    await linuxBox.recreateBox(ns, challengeId, flavor, spec.box);
  } catch (err) {
    console.error(`[${flavor}] ${ns}: could not start a box for ${challengeId}: ${(err as Error).message || err}`);
    throw labEnvUnavailable();
  }
  const result = await k8s.runChallengeScript(ns, challengeId, spec.setup?.script || 'setup.sh', {
    timeoutMs: 180_000,
    env: linuxBox.scriptEnv(),
  });
  if (result.code !== 0) {
    const msg = (result.stderr || result.stdout || 'setup failed').trim();
    throw Object.assign(new Error(`Lab setup failed: ${msg}`), { status: 502 });
  }
  return true;
}

/**
 * A lab only ever starts on an empty namespace. Leftovers mean an earlier park
 * or wipe failed; they are never silently deleted here (they may be unsaved
 * work), so the open is refused until the retry succeeds or an admin clears it.
 */
async function ensureCleanSlate(
  ns: string,
  challengeId: string,
  forceSetup: boolean,
  spec: ReturnType<typeof platformSpecOf>,
): Promise<void> {
  try {
    await k8s.ensureLearnerNamespace(ns, {
      quota: spec.quota || {},
      limitRange: spec.limitRange,
      reconcileLimits: true,
    });
    const pending = unparked.get(ns);
    if (pending) await park(ns, pending);
    if (forceSetup) {
      k8s.deleteChallengeSnapshot(ns, challengeId);
      await k8s.wipeChallengeResources(ns, challengeId);
    }
    const left = await k8s.listLeftoverResources(ns);
    if (left.length) {
      throw new Error(`${left.length} leftover object(s): ${left.slice(0, 10).join(', ')}`);
    }
  } catch (err) {
    console.error(
      `[k8s] ${ns} is not a clean slate, refusing to open ${challengeId}: ${(err as Error).message || err}`,
    );
    throw labEnvUnavailable();
  }
}

async function provision(
  ns: string,
  challengeId: string,
  forceSetup: boolean,
): Promise<boolean> {
  const spec = platformSpecOf(challengeId);
  await requirePool(ns, challengeId);
  await ensureCleanSlate(ns, challengeId, forceSetup, spec);
  // The session is already active, so this reserves the lab's slots before setup runs.
  if (!(await capacity.waitForReservation(ns))) throw labCapacityDown();

  if (!forceSetup) {
    // Resume: re-apply parked namespace state from last session end.
    const restored = await k8s.restoreChallengeSnapshot(ns, challengeId);
    if (restored) {
      await k8s.markChallengeSetup(ns, challengeId);
      await capacity.waitForPodsScheduled(ns);
      return true;
    }
    // Do not skip setup just because the NS annotation is set — a prior open can
    // mark setup complete while prerun workloads are missing (old script, wipe,
    // or timed-out seed). setup.sh is idempotent (kubectl apply).
  }

  const script = spec.setup?.script || 'setup.sh';
  // Postgres image pulls (C9+) often exceed the old 90s default.
  const result = await k8s.runChallengeScript(ns, challengeId, script, {
    timeoutMs: 180_000,
  });
  if (result.code !== 0) {
    const msg = (result.stderr || result.stdout || 'setup failed').trim();
    if (CAPACITY_FAILURE.test(msg)) {
      console.warn(`[k8s] ${ns}: setup for ${challengeId} hit a capacity limit: ${msg}`);
      throw labCapacityDown();
    }
    throw Object.assign(new Error(`Lab setup failed: ${msg}`), { status: 502 });
  }
  await k8s.markChallengeSetup(ns, challengeId);
  // The start response (and so the terminal) waits until setup pods have a node.
  await capacity.waitForPodsScheduled(ns);
  return true;
}

/** The learner's namespace, as startK8sSession derives it. */
function namespaceFor(userId: string | null, userName: string | null): string {
  const owner = workspaceStore.sanitizeOwner(userId || 'anonymous');
  return k8s.learnerNamespace(userName || owner);
}

function namespaceForChallenge(challengeId: string, userId: string | null, userName: string | null): string {
  const flavor = boxFlavorOf(challengeId);
  if (!flavor) return namespaceFor(userId, userName);
  const owner = workspaceStore.sanitizeOwner(userId || 'anonymous');
  return linuxBox.boxNamespace(userName || owner, flavor);
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
  if (!isClusterLabType(listed.sandboxType)) {
    throw Object.assign(new Error('not a kubernetes lab'), { status: 400 });
  }

  const owner = workspaceStore.sanitizeOwner(userId || candidateName || 'anonymous');
  const ns = namespaceForChallenge(challengeId, userId || candidateName, userName || candidateName);

  const existing = await findExistingK8sSession(challengeId, owner);
  if (existing && existing.status === 'active') {
    // Still live (another tab, a reload, or leaving without ending): its objects
    // are in the namespace and not parked, so resume as-is. Waiting on the lock
    // lets an open that is still provisioning finish first.
    await withNsLock(ns, async () => undefined);
    if (existing.status === 'active') {
      existing.lastActivityAt = Date.now();
      return { session: existing, created: false, provisioned: false };
    }
  }
  if (existing) {
    existing.status = 'active';
    existing.endTime = null;
    existing.runtime = 'kubernetes';
    existing.userId = owner;
    existing.k8sNamespace = ns;
    existing.workspacePrefix = ns;
    existing.candidateName = candidateName || existing.candidateName;
    sessionStore.set(existing.id, existing);

    let provisioned: boolean;
    try {
      provisioned = await ensureProvisioned(ns, challengeId, false);
    } catch (err) {
      // Not via endK8sSession: parking now would snapshot whatever blocked the open.
      existing.status = 'ended';
      existing.endTime = Date.now();
      await sessionStore.persistRow(existing).catch(() => {});
      throw err;
    }
    await sessionStore.persistRow(existing);
    existing.lastActivityAt = Date.now();
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
  session.lastActivityAt = Date.now();

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
  const session = sessionStore.get(sessionId) as
    | (GameSession & { k8sNamespace?: string })
    | null;
  if (!session) {
    throw Object.assign(new Error('session not found'), { status: 404 });
  }
  if (session.status === 'ended') {
    return session;
  }
  const ns = session.k8sNamespace || session.workspacePrefix;
  const challengeId = session.challengeId;

  // Mark ended immediately so the client can leave; park/wipe runs in background.
  session.status = 'ended';
  session.endTime = Date.now();
  await sessionStore.persistRow(session);
  void capacity.nudge();

  const flavor = challengeId ? boxFlavorOf(challengeId) : null;
  if (ns && challengeId && flavor) {
    void withNsLock(ns, () => linuxBox.deleteBox(ns)).catch((err: unknown) => {
      console.warn(`[${flavor}] background box delete failed for ${ns}: ${(err as Error).message || err}`);
    });
  } else if (ns && challengeId) {
    void withNsLock(ns, () => park(ns, challengeId)).catch((err: unknown) => {
      console.warn(
        `[k8s] background park failed for ${ns}/${challengeId}: ${(err as Error).message || err}`,
      );
    });
  }
  return session;
}

module.exports = {
  namespaceFor,
  labAvailability,
  startK8sSession,
  resetK8sSession,
  endK8sSession,
  findExistingK8sSession,
};
