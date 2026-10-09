'use strict';

/**
 * Paid subtracks lock their labs unless the user's plan covers the subtrack.
 * A lab's subtrack is its pack `category`; ids match billing plan `covers`.
 */

type LabUser = { sub?: string; userId?: string; admin?: boolean; role?: string | null; email?: string | null };

const PAID_TRACKS = new Set<string>(['linux', 'docker', 'kubernetes']);

/** First three labs of each subtrack in Play order (frontend/src/constants/playCatalog.ts). */
const FREE_LAB_IDS = new Set<string>([
  'linux-00-first-shift-on-the-order-box',
  'linux-01-organize-the-release-folder',
  'linux-02-find-the-misplaced-configs',
  'docker-00-first-container-on-the-order-box',
  'docker-01-run-order-processor-in-a-container',
  'docker-02-inspect-and-manage-payment-handler',
  'k8s-00-meet-kubectl',
  'l1-namespace-and-pod',
  'k8s-02-scale-out-with-a-replicaset',
]);

function paidTrackOf(challenge: { category?: string | null } | null | undefined): string | null {
  const category = String(challenge?.category || '');
  return PAID_TRACKS.has(category) ? category : null;
}

function userIdOf(user: LabUser | null | undefined): string | null {
  return user?.sub || user?.userId || null;
}

/** The JWT role can be up to 8h stale, so a reviewer claim is confirmed against the DB. */
async function isStaff(user: LabUser | null | undefined): Promise<boolean> {
  const { isAdminUser } = require('../auth/middleware');
  if (isAdminUser(user)) return true;
  const uid = userIdOf(user);
  if (user?.role !== 'reviewer' || !uid) return false;
  const { findUserById } = require('../auth/companyStore');
  const dbUser: { role?: string } | null = await findUserById(uid);
  return dbUser?.role === 'reviewer';
}

/** Subtracks the user may open past the free labs (staff get all of them). */
async function unlockedTracks(user: LabUser | null | undefined): Promise<Set<string>> {
  if (await isStaff(user)) return new Set(PAID_TRACKS);
  const uid = userIdOf(user);
  if (!uid) return new Set();
  const { getEntitlements } = require('./store');
  return new Set<string>(await getEntitlements(uid));
}

function isLabLocked(
  challenge: { id: string; category?: string | null },
  unlocked: Set<string>,
): boolean {
  const track = paidTrackOf(challenge);
  if (!track || FREE_LAB_IDS.has(challenge.id)) return false;
  return !unlocked.has(track);
}

/** Throws 402 LAB_LOCKED when the user's plan doesn't cover this lab's subtrack. */
async function assertLabUnlocked(
  user: LabUser | null | undefined,
  challenge: { id: string; category?: string | null },
): Promise<void> {
  if (!isLabLocked(challenge, await unlockedTracks(user))) return;
  const err = new Error('This lab is part of a paid track. Subscribe to unlock it.') as Error & {
    status?: number;
    code?: string;
    details?: Record<string, unknown>;
  };
  err.status = 402;
  err.code = 'LAB_LOCKED';
  err.details = { track: paidTrackOf(challenge) };
  throw err;
}

module.exports = { FREE_LAB_IDS, paidTrackOf, unlockedTracks, isLabLocked, assertLabUnlocked };
