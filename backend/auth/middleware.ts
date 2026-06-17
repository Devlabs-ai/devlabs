'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const { verifyToken } = require('./jwt');
const invites = require('./invites');

function bearer(req: ExpressRequest): string | null {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim();
}

// Attach req.user for any valid JWT (interviewer OR admin).
// The token may come from either the legacy username/password login
// (role='interviewer', no companyId) or the new OTP login.
function requireInterviewer(req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void {
  const token = bearer(req);
  if (!token) { res.status(401).json({ error: 'missing bearer token' }); return; }

  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: 'invalid or expired token' }); return; }

  // Both 'interviewer' and 'admin' can reach interviewer-gated endpoints
  if (payload.role !== 'interviewer' && payload.role !== 'admin') {
    res.status(403).json({ error: 'insufficient permissions' }); return;
  }

  req.user = payload;
  next();
}

// Only company admins (or legacy admin login) may reach admin-gated endpoints.
function requireAdmin(req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void {
  const token = bearer(req);
  if (!token) { res.status(401).json({ error: 'missing bearer token' }); return; }

  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: 'invalid or expired token' }); return; }

  if (payload.role !== 'admin') {
    res.status(403).json({ error: 'admin role required' }); return;
  }

  req.user = payload;
  next();
}

// Allows interviewers/admins (via JWT) OR candidates (via invite token).
async function requireSessionAccess(req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): Promise<void> {
  const token = bearer(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload && (payload.role === 'interviewer' || payload.role === 'admin')) {
      req.user = payload;
      next();
      return;
    }
  }

  const candidateToken = (req.body as Record<string, unknown>)?.candidateToken;
  if (candidateToken) {
    try {
      const invite = await invites.resolveInvite(candidateToken);
      if (invite && !invite.expired) {
        req.candidate = invite;
        next();
        return;
      }
    } catch (e: unknown) {
      console.warn('[auth] candidate invite lookup failed', (e as Error).message);
    }
  }

  res.status(401).json({ error: 'unauthenticated' });
}

module.exports = { requireInterviewer, requireAdmin, requireSessionAccess };
