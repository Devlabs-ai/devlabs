'use strict';

import type { AuthRole, JwtPayload } from '../types/domain';

const jwt = require('jsonwebtoken');

const EXPIRES_IN = '8h';

function getSecret(): string {
  return process.env.JWT_SECRET || 'devlabs-dev-secret';
}

// Issue a token for a real user (OTP login)
function signUserToken({
  userId,
  email,
  role,
  companyId,
}: {
  userId: string;
  email: string;
  role: AuthRole;
  companyId: string | null;
}): string {
  return jwt.sign(
    { sub: userId, email, role, companyId },
    getSecret(),
    { expiresIn: EXPIRES_IN },
  );
}

// Legacy: kept for backward-compat with the old username/password login
// during transition. Remove once all clients use OTP.
function signInterviewerToken(sub = 'admin'): string {
  return jwt.sign({ sub, role: 'interviewer' }, getSecret(), { expiresIn: EXPIRES_IN });
}

function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getSecret()) as JwtPayload;
  } catch (_e) {
    return null;
  }
}

module.exports = { signUserToken, signInterviewerToken, verifyToken };
