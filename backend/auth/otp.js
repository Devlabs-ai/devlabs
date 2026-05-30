'use strict';

// OTP management — stored in Redis with a 10-minute TTL.
//
// Key schema:  otp:<email>
// Value:       JSON { hash: bcrypt(code), attempts: 0 }
// TTL:         OTP_TTL_S seconds (default 600 = 10 min)
//
// Brute-force guard: after MAX_ATTEMPTS failed verifications the key is
// deleted, forcing the user to request a new code.

const bcrypt = require('bcryptjs');
const redis = require('../cache/redis');

const OTP_TTL_S = 10 * 60;   // 10 minutes
const OTP_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const BCRYPT_ROUNDS = 10;

function redisKey(email) {
  return `otp:${email.toLowerCase().trim()}`;
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Generate and store a new OTP. Returns the plaintext code (caller sends it).
async function createOtp(email) {
  const code = generateCode();
  const hash = await bcrypt.hash(code, BCRYPT_ROUNDS);
  const value = JSON.stringify({ hash, attempts: 0 });
  const key = redisKey(email);

  const rc = redis.client();
  if (!rc || !redis.isReady()) throw new Error('Redis unavailable — cannot issue OTP');

  await rc.set(key, value, 'EX', OTP_TTL_S);
  return code;
}

// Verify a submitted code. Returns:
//   { ok: true }                  — code correct, key deleted
//   { ok: false, reason: string } — wrong code or expired
async function verifyOtp(email, code) {
  const key = redisKey(email);
  const rc = redis.client();
  if (!rc || !redis.isReady()) return { ok: false, reason: 'Redis unavailable' };

  const raw = await rc.get(key);
  if (!raw) return { ok: false, reason: 'OTP expired or not requested' };

  let entry;
  try { entry = JSON.parse(raw); } catch (_e) {
    await rc.del(key);
    return { ok: false, reason: 'Invalid OTP state' };
  }

  const match = await bcrypt.compare(String(code), entry.hash);
  if (match) {
    await rc.del(key);
    return { ok: true };
  }

  entry.attempts += 1;
  if (entry.attempts >= MAX_ATTEMPTS) {
    await rc.del(key);
    return { ok: false, reason: `Too many failed attempts — request a new code` };
  }

  await rc.set(key, JSON.stringify(entry), 'KEEPTTL');
  return { ok: false, reason: `Incorrect code (${MAX_ATTEMPTS - entry.attempts} attempt(s) remaining)` };
}

module.exports = { createOtp, verifyOtp };
