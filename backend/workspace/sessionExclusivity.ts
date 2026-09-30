'use strict';

/**
 * One open lab per user, open in one browser tab.
 *
 * - Starting a lab while another lab is active → 409 ACTIVE_LAB_ELSEWHERE
 *   (client may retry with force=true to end the other lab first).
 * - Each tab sends a random clientId and heartbeats; a second tab on the same
 *   session gets 409 LAB_OPEN_IN_OTHER_TAB until it takes over with force=true.
 */

import type { GameSession } from '../types/domain';

const sessionStore = require('../db/sessionStore');
const { sanitizeOwner } = require('./workspaceStore');
const loader = require('../challenges/loader');

const LAB_RUNTIMES = new Set(['kubernetes', 'spark-platform', 'board']);
const EXEMPT_CHALLENGES = new Set(['spark-playground']);

/** Tabs heartbeat every ~15s; a lease older than this is treated as abandoned. */
const LEASE_TTL_MS = Math.max(20_000, Number(process.env.SESSION_TAB_LEASE_MS || 45_000));

type Lease = { clientId: string; seenAt: number };
const leases = new Map<string, Lease>();

type HttpError = Error & { status?: number; code?: string; details?: Record<string, unknown> };

function conflict(code: string, message: string, details: Record<string, unknown>): HttpError {
  return Object.assign(new Error(message), { status: 409, code, details });
}

function ownerOf(userId: string | null | undefined): string {
  return sanitizeOwner(String(userId || 'anonymous'));
}

function isLabSession(s: GameSession): boolean {
  return (
    s.status === 'active'
    && LAB_RUNTIMES.has(String(s.runtime || ''))
    && !EXEMPT_CHALLENGES.has(String(s.challengeId || ''))
  );
}

function activeLabSessionsFor(owner: string): GameSession[] {
  return (sessionStore.all() as GameSession[]).filter(
    (s) => isLabSession(s) && ownerOf(s.userId) === owner,
  );
}

function titleOf(challengeId: string | null | undefined): string | null {
  const c = challengeId ? loader.getChallenge(challengeId) : null;
  return (c && c.title) || null;
}

function leaseHeldByOther(sessionId: string, clientId: string | null): Lease | null {
  const lease = leases.get(sessionId);
  if (!lease || !clientId || lease.clientId === clientId) return null;
  if (Date.now() - lease.seenAt > LEASE_TTL_MS) return null;
  return lease;
}

/**
 * Run before starting a lab. Throws 409 on conflict unless force; with force,
 * ends other active labs (via endSession) and lets this tab take over.
 */
async function assertCanStart({
  userId,
  challengeId,
  clientId,
  force,
  endSession,
}: {
  userId: string | null | undefined;
  challengeId: string;
  clientId: string | null;
  force: boolean;
  endSession: (sessionId: string) => Promise<void>;
}): Promise<void> {
  if (!challengeId || EXEMPT_CHALLENGES.has(challengeId)) return;
  const owner = ownerOf(userId);
  const active = activeLabSessionsFor(owner);

  const others = active.filter((s) => s.challengeId !== challengeId);
  if (others.length && !force) {
    const first = others[0];
    throw conflict('ACTIVE_LAB_ELSEWHERE', `You already have "${titleOf(first.challengeId) || first.challengeId}" open. End it before starting another lab.`, {
      active: {
        sessionId: first.id,
        challengeId: first.challengeId,
        title: titleOf(first.challengeId),
      },
    });
  }

  const same = active.find((s) => s.challengeId === challengeId);
  if (same && !force && leaseHeldByOther(same.id, clientId)) {
    throw conflict('LAB_OPEN_IN_OTHER_TAB', 'This lab is already open in another tab or window.', {
      active: { sessionId: same.id, challengeId, title: titleOf(challengeId) },
    });
  }

  if (force) {
    for (const s of others) {
      leases.delete(s.id);
      await endSession(s.id);
    }
  }
}

type LeaseMovedListener = (sessionId: string, clientId: string) => void;
const leaseMovedListeners = new Set<LeaseMovedListener>();

/** Called when a different tab takes a session's lease (forced or after the old one lapsed). */
function onLeaseMoved(listener: LeaseMovedListener): void {
  leaseMovedListeners.add(listener);
}

/** Claim / refresh this tab's lease. Returns false when another live tab holds it. */
function heartbeat(sessionId: string, clientId: string | null, force = false): boolean {
  if (!clientId) return true;
  if (!force && leaseHeldByOther(sessionId, clientId)) return false;
  const prev = leases.get(sessionId);
  leases.set(sessionId, { clientId, seenAt: Date.now() });
  if (prev && prev.clientId !== clientId) {
    for (const listener of leaseMovedListeners) {
      try {
        listener(sessionId, clientId);
      } catch (err: unknown) {
        console.warn(`[session-exclusivity] lease-moved listener failed: ${(err as Error).message}`);
      }
    }
  }
  return true;
}

/** False only when another live tab holds the lease; unknown clients are let through. */
function isLeaseHolder(sessionId: string, clientId: string | null): boolean {
  return !leaseHeldByOther(sessionId, clientId);
}

function release(sessionId: string, clientId?: string | null): void {
  const lease = leases.get(sessionId);
  if (!lease) return;
  if (clientId && lease.clientId !== clientId) return;
  leases.delete(sessionId);
}

module.exports = {
  LEASE_TTL_MS,
  assertCanStart,
  heartbeat,
  isLeaseHolder,
  onLeaseMoved,
  release,
};
