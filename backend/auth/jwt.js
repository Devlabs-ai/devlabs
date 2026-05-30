'use strict';

const jwt = require('jsonwebtoken');

const EXPIRES_IN = '8h';

function getSecret() {
  return process.env.JWT_SECRET || 'devlabs-dev-secret';
}

// Issue a token for a real user (OTP login)
function signUserToken({ userId, email, role, companyId }) {
  return jwt.sign(
    { sub: userId, email, role, companyId },
    getSecret(),
    { expiresIn: EXPIRES_IN },
  );
}

// Legacy: kept for backward-compat with the old username/password login
// during transition. Remove once all clients use OTP.
function signInterviewerToken(sub = 'admin') {
  return jwt.sign({ sub, role: 'interviewer' }, getSecret(), { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch (_e) {
    return null;
  }
}

module.exports = { signUserToken, signInterviewerToken, verifyToken };
