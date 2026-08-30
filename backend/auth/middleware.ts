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

function isAdminUser(user: { sub?: string; userId?: string; email?: string } | null | undefined): boolean {
  if (!user) return false;
  const id = String(user.sub || user.userId || '');
  if (id === 'admin') return true;
  const emails = adminEmails();
  // No allowlist configured → every signed-in user can author (private lab).
  if (!emails.length) return true;
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

/** Admin authoring (sub=admin or ADMIN_EMAILS). */
function requireAdmin(req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void {
  requireInterviewer(req, res, () => {
    if (res.headersSent) return;
    if (!isAdminUser(req.user)) {
      res.status(403).json({ error: 'admin only' });
      return;
    }
    next();
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

module.exports = { requireInterviewer, requireAdmin, requireSessionAccess, isAdminUser };
