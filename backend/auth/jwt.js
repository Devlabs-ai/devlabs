'use strict';

const jwt = require('jsonwebtoken');

const EXPIRES_IN = '8h';

function getSecret() {
  return process.env.JWT_SECRET || 'devlabs-dev-secret';
}

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

module.exports = { signInterviewerToken, verifyToken };
