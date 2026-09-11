'use strict';

import type { JwtPayload } from '../types/domain';

const jwt = require('jsonwebtoken');

const EXPIRES_IN = '8h';

function getSecret(): string {
  return process.env.JWT_SECRET || 'devlabs-dev-secret';
}

function signUserToken({
  userId,
  email,
}: {
  userId: string;
  email: string;
}): string {
  return jwt.sign(
    { sub: userId, email },
    getSecret(),
    { expiresIn: EXPIRES_IN },
  );
}

/** Legacy username/password login helper. */
function signInterviewerToken(sub = 'admin'): string {
  return jwt.sign({ sub }, getSecret(), { expiresIn: EXPIRES_IN });
}

function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getSecret()) as JwtPayload;
  } catch (_e) {
    return null;
  }
}

module.exports = { signUserToken, signInterviewerToken, verifyToken };
