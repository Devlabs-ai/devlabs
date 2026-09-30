'use strict';

/** Platform roles — assigned by admin on approval or later. */

export type UserRole = 'admin' | 'reviewer' | 'learner';

export const USER_ROLES: UserRole[] = ['admin', 'reviewer', 'learner'];

/**
 * Play hub tracks a reviewer may be scoped to (PLAY_DOMAINS ids).
 * Keep in sync with frontend `REVIEW_TRACKS` / `playCatalog.PLAY_DOMAINS`.
 */
export const REVIEW_TRACK_IDS = [
  'data-engineer',
  'software-engineer',
  'devops-engineer',
  'platforms-engineer',
  'distributed-systems-engineer',
] as const;

export type ReviewTrackId = (typeof REVIEW_TRACK_IDS)[number];

const ROLE_SET = new Set<string>(USER_ROLES);
const TRACK_SET = new Set<string>(REVIEW_TRACK_IDS);

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && ROLE_SET.has(value);
}

export function parseUserRole(value: unknown, fallback: UserRole = 'learner'): UserRole {
  return isUserRole(value) ? value : fallback;
}

export function normalizeReviewTracks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = String(item || '').trim();
    if (!id || !TRACK_SET.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Review tracks only apply to reviewers; other roles store []. */
export function reviewTracksForRole(role: UserRole, tracks: unknown): string[] {
  if (role !== 'reviewer') return [];
  return normalizeReviewTracks(tracks);
}

export function roleImpliesAdmin(role: UserRole): boolean {
  return role === 'admin';
}

module.exports = {
  USER_ROLES,
  REVIEW_TRACK_IDS,
  isUserRole,
  parseUserRole,
  normalizeReviewTracks,
  reviewTracksForRole,
  roleImpliesAdmin,
};
