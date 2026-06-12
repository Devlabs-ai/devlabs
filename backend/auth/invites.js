'use strict';

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

const ADJECTIVES = [
  'swift', 'brave', 'silent', 'curious', 'bold', 'cosmic', 'lucky', 'merry',
  'quiet', 'sunny', 'witty', 'fierce', 'gentle', 'noble', 'humble', 'eager',
];
const ANIMALS = [
  'eagle', 'tiger', 'otter', 'falcon', 'wolf', 'panda', 'lynx', 'fox',
  'whale', 'hawk', 'owl', 'bear', 'koala', 'cobra', 'shark', 'raven',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeFriendlyName() {
  const n = Math.floor(Math.random() * 90) + 10;
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}-${n}`;
}

function isInviteExpired(expiresAt) {
  if (expiresAt == null) return false;
  return Date.now() > Number(expiresAt);
}

function mapInviteRow(r) {
  const expiresAt = r.expires_at != null ? Number(r.expires_at) : null;
  const expired = isInviteExpired(expiresAt);
  return {
    token: r.token,
    name: r.name,
    challengeId: r.challenge_id,
    candidateEmail: r.candidate_email || null,
    createdBy: r.created_by || null,
    challengeTitle: r.challenge_title || null,
    conductedByName: r.conducted_by_name || null,
    createdAt: Number(r.created_at),
    expiresAt,
    expired,
    used: r.used,
  };
}

async function createInvite({ challengeId, name, email, createdBy }) {
  const token = uuidv4();
  const finalName = (name && String(name).trim()) || makeFriendlyName();
  const finalEmail = String(email || '').toLowerCase().trim();
  const now = Date.now();
  const expiresAt = now + INVITE_TTL_MS;

  await pool.query(
    `INSERT INTO invites (token, name, challenge_id, candidate_email, created_by, created_at, expires_at, used)
     VALUES ($1,$2,$3,$4,$5,$6,$7,false)`,
    [token, finalName, challengeId || null, finalEmail || null, createdBy || null, now, expiresAt],
  );

  return {
    token,
    name: finalName,
    challengeId: challengeId || null,
    candidateEmail: finalEmail || null,
    createdBy: createdBy || null,
    createdAt: now,
    expiresAt,
    expired: false,
    used: false,
  };
}

async function listInvitesForUser(userId) {
  const { rows } = await pool.query(
    `SELECT i.token, i.name, i.challenge_id, i.candidate_email, i.created_by,
            i.created_at, i.expires_at, i.used,
            c.title AS challenge_title,
            u.name AS conducted_by_name
       FROM invites i
       LEFT JOIN challenges c ON c.id = i.challenge_id
       LEFT JOIN users u ON u.id = i.created_by
      WHERE i.created_by = $1
      ORDER BY i.created_at DESC`,
    [userId],
  );
  return rows.map(mapInviteRow);
}

async function resolveInvite(token) {
  const { rows } = await pool.query(
    `SELECT token, name, challenge_id, used, expires_at FROM invites WHERE token = $1`,
    [token],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  if (isInviteExpired(r.expires_at)) {
    return { expired: true };
  }
  return {
    token: r.token,
    name: r.name,
    challengeId: r.challenge_id,
    used: r.used,
    expiresAt: r.expires_at != null ? Number(r.expires_at) : null,
  };
}

async function markUsed(token) {
  await pool.query(`UPDATE invites SET used = true WHERE token = $1`, [token]);
}

module.exports = {
  createInvite,
  listInvitesForUser,
  resolveInvite,
  markUsed,
  INVITE_TTL_MS,
};
