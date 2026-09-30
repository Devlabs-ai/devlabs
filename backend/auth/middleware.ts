'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const { verifyToken } = require('./jwt');

function bearer(req: ExpressRequest): string | null {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim();
}

function adminEmails(): string[] {
  return String(process.env.ADMIN_EMAILS || '')
    .split(/[,;\s]+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean);
}

/**
 * Fast path from JWT: admin claim (set at login), role claim, or ADMIN_EMAILS allowlist.
 */
function isAdminUser(
  user: {
    sub?: string;
    userId?: string;
    email?: string;
    admin?: boolean;
    role?: string;
  } | null | undefined,
): boolean {
  if (!user) return false;
  if (user.admin === true || user.role === 'admin') return true;
  const emails = adminEmails();
  if (!emails.length) return false;
  const email = String(user.email || '').toLowerCase();
  return Boolean(email && emails.includes(email));
}

function resolveAdminFlag(user: {
  email?: string | null;
  isAdmin?: boolean;
  is_admin?: boolean;
  role?: string | null;
} | null | undefined): boolean {
  if (!user) return false;
  if (user.isAdmin || user.is_admin || user.role === 'admin') return true;
  const emails = adminEmails();
  const email = String(user.email || '').toLowerCase();
  return Boolean(email && emails.includes(email));
}

/** Any valid signed-in user JWT. */
function requireInterviewer(req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void {
  const token = bearer(req);
  if (!token) { res.status(401).json({ error: 'missing bearer token' }); return; }

  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: 'invalid or expired token' }); return; }

  req.user = payload;
  next();
}

/** Admin authoring / dashboard — JWT claim, ADMIN_EMAILS, or users.is_admin. */
function requireAdmin(req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void {
  requireInterviewer(req, res, () => {
    if (res.headersSent) return;
    if (isAdminUser(req.user)) {
      next();
      return;
    }

    const userId = String(req.user?.sub || req.user?.userId || '');
    if (!userId) {
      res.status(403).json({ error: 'admin only' });
      return;
    }

    const { findUserById } = require('./companyStore');
    findUserById(userId)
      .then((dbUser: { isAdmin?: boolean; email?: string; role?: string } | null) => {
        if (res.headersSent) return;
        if (dbUser && resolveAdminFlag(dbUser)) {
          if (req.user) req.user.admin = true;
          next();
          return;
        }
        res.status(403).json({ error: 'admin only' });
      })
      .catch((e: unknown) => next(e));
  });
}

/** Admin or reviewer — for challenge Review tab. */
function requireReviewStaff(req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void {
  requireInterviewer(req, res, () => {
    if (res.headersSent) return;
    const { canAccessReviewTab } = require('../challenges/access');
    if (canAccessReviewTab(req.user)) {
      next();
      return;
    }

    const userId = String(req.user?.sub || req.user?.userId || '');
    if (!userId) {
      res.status(403).json({ error: 'reviewers and admins only' });
      return;
    }

    const { findUserById } = require('./companyStore');
    findUserById(userId)
      .then((dbUser: { isAdmin?: boolean; email?: string; role?: string } | null) => {
        if (res.headersSent) return;
        if (dbUser && canAccessReviewTab({ ...dbUser, admin: resolveAdminFlag(dbUser) })) {
          if (req.user && dbUser.role) req.user.role = dbUser.role as 'admin' | 'reviewer' | 'learner';
          if (req.user && resolveAdminFlag(dbUser)) req.user.admin = true;
          next();
          return;
        }
        res.status(403).json({ error: 'reviewers and admins only' });
      })
      .catch((e: unknown) => next(e));
  });
}

function requireSessionAccess(req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void {
  const token = bearer(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
      next();
      return;
    }
  }
  res.status(401).json({ error: 'unauthenticated' });
}

module.exports = {
  requireInterviewer,
  requireAdmin,
  requireReviewStaff,
  requireSessionAccess,
  isAdminUser,
  resolveAdminFlag,
};
