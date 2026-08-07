'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const { verifyToken } = require('./jwt');

function bearer(req: ExpressRequest): string | null {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim();
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

/** @deprecated Alias — roles removed; same as requireInterviewer. */
function requireAdmin(req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void {
  return requireInterviewer(req, res, next);
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

module.exports = { requireInterviewer, requireAdmin, requireSessionAccess };
