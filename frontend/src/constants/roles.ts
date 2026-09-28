/** Platform roles — assigned by admin. Keep track ids in sync with backend/auth/roles.ts. */

import { PLAY_DOMAINS } from './playCatalog';

export type UserRole = 'admin' | 'reviewer' | 'learner';

export const USER_ROLES: UserRole[] = ['admin', 'reviewer', 'learner'];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  reviewer: 'Reviewer',
  learner: 'Learner',
};

/**
 * Play hub tracks a reviewer may be scoped to (same ids as PLAY_DOMAINS).
 * Example: data-engineer, devops-engineer.
 */
export const REVIEW_TRACKS: Array<{ id: string; label: string }> = PLAY_DOMAINS.map((d) => ({
  id: d.id,
  label: d.label,
}));

export const REVIEW_TRACK_IDS = REVIEW_TRACKS.map((t) => t.id);

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as string[]).includes(value);
}

export function userRoleLabel(role: UserRole | string | null | undefined): string {
  if (role && isUserRole(role)) return USER_ROLE_LABELS[role];
  return USER_ROLE_LABELS.learner;
}

export function reviewTrackLabel(trackId: string): string {
  return REVIEW_TRACKS.find((t) => t.id === trackId)?.label || trackId;
}

export type ChallengeVisibleTo = 'admin' | 'reviewers' | 'users';

export interface VisibilityMark {
  key: ChallengeVisibleTo;
  letter: 'A' | 'R' | 'P';
  label: string;
}

/** Compact track-list notation: Admin / Review / Public. */
export function visibilityMark(
  visibleTo: string | null | undefined,
): VisibilityMark {
  const raw = String(visibleTo || 'admin').trim().toLowerCase();
  if (raw === 'users') {
    return { key: 'users', letter: 'P', label: 'Public — learners can open' };
  }
  if (raw === 'reviewers') {
    return { key: 'reviewers', letter: 'R', label: 'Review — reviewers only' };
  }
  return { key: 'admin', letter: 'A', label: 'Admin — admins only' };
}

