'use strict';

/** Who may open a challenge in Play / start a session. */

export type ChallengeVisibleTo = 'admin' | 'reviewers' | 'users';

const VISIBLE_TO = new Set<string>(['admin', 'reviewers', 'users']);

export function parseVisibleTo(value: unknown, fallback: ChallengeVisibleTo = 'admin'): ChallengeVisibleTo {
  const raw = String(value || '').trim().toLowerCase();
  if (VISIBLE_TO.has(raw)) return raw as ChallengeVisibleTo;
  return fallback;
}

function roleOf(user: {
  admin?: boolean;
  role?: string | null;
  email?: string | null;
} | null | undefined): 'admin' | 'reviewer' | 'learner' {
  const { isAdminUser } = require('../auth/middleware');
  if (isAdminUser(user) || user?.role === 'admin') return 'admin';
  if (user?.role === 'reviewer') return 'reviewer';
  return 'learner';
}

/**
 * - admin: admins only
 * - reviewers: admins + reviewers
 * - users: admins + reviewers + learners
 */
function canViewChallenge(
  user: { admin?: boolean; role?: string | null; email?: string | null } | null | undefined,
  visibleTo: unknown,
): boolean {
  const role = roleOf(user);
  const audience = parseVisibleTo(visibleTo, 'admin');
  if (role === 'admin') return true;
  if (audience === 'admin') return false;
  if (audience === 'reviewers') return role === 'reviewer';
  return true; // users
}

function canAccessReviewTab(
  user: { admin?: boolean; role?: string | null; email?: string | null } | null | undefined,
): boolean {
  const role = roleOf(user);
  return role === 'admin' || role === 'reviewer';
}

function canManageVisibility(
  user: { admin?: boolean; role?: string | null; email?: string | null } | null | undefined,
): boolean {
  return roleOf(user) === 'admin';
}

module.exports = {
  parseVisibleTo,
  canViewChallenge,
  canAccessReviewTab,
  canManageVisibility,
};
