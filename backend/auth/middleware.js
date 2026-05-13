'use strict';

const { verifyToken } = require('./jwt');
const invites = require('./invites');

function bearer(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim();
}

function requireInterviewer(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'missing bearer token' });
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'interviewer') {
    return res.status(401).json({ error: 'invalid token' });
  }
  req.user = payload;
  next();
}

async function requireSessionAccess(req, res, next) {
  const token = bearer(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload && payload.role === 'interviewer') {
      req.user = payload;
      return next();
    }
  }

  const candidateToken = req.body && req.body.candidateToken;
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

module.exports = { requireInterviewer, requireSessionAccess };
