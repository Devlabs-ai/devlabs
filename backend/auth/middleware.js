'use strict';

const { verifyToken } = require('./jwt');
const invites = require('./invites');

function bearer(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim();
}

// Attach req.user for any valid JWT (interviewer OR admin).
// The token may come from either the legacy username/password login
// (role='interviewer', no companyId) or the new OTP login.
function requireInterviewer(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'missing bearer token' });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'invalid or expired token' });

  // Both 'interviewer' and 'admin' can reach interviewer-gated endpoints
  if (payload.role !== 'interviewer' && payload.role !== 'admin') {
    return res.status(403).json({ error: 'insufficient permissions' });
  }

  req.user = payload;
  next();
}

// Only company admins (or legacy admin login) may reach admin-gated endpoints.
function requireAdmin(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'missing bearer token' });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'invalid or expired token' });

  if (payload.role !== 'admin') {
    return res.status(403).json({ error: 'admin role required' });
  }

  req.user = payload;
  next();
}

// Allows interviewers/admins (via JWT) OR candidates (via invite token).
async function requireSessionAccess(req, res, next) {
  const token = bearer(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload && (payload.role === 'interviewer' || payload.role === 'admin')) {
      req.user = payload;
      return next();
    }
  }

  const candidateToken = req.body?.candidateToken;
  if (candidateToken) {
    try {
      const invite = await invites.resolveInvite(candidateToken);
      if (invite) {
        req.candidate = invite;
        return next();
      }
    } catch (e) {
      console.warn('[auth] candidate invite lookup failed', e.message);
    }
  }

  return res.status(401).json({ error: 'unauthenticated' });
}

module.exports = { requireInterviewer, requireAdmin, requireSessionAccess };
