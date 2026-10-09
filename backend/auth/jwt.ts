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
  admin = false,
  role = 'learner',
  reviewTracks = [],
}: {
  userId: string;
  email: string;
  admin?: boolean;
  role?: string;
  reviewTracks?: string[];
}): string {
  return jwt.sign(
    {
      sub: userId,
      email,
      admin: Boolean(admin),
      role: role || 'learner',
      reviewTracks: Array.isArray(reviewTracks) ? reviewTracks : [],
    },
    getSecret(),
    { expiresIn: EXPIRES_IN },
  );
}

function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getSecret()) as JwtPayload;
  } catch (_e) {
    return null;
  }
}

module.exports = { signUserToken, verifyToken };
