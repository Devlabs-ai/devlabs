'use strict';

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');

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

async function createInvite({ challengeId, name }) {
  const token = uuidv4();
  const finalName = name || makeFriendlyName();
  const now = Date.now();

  await pool.query(
    `INSERT INTO invites (token, name, challenge_id, created_at, used)
     VALUES ($1,$2,$3,$4,false)`,
    [token, finalName, challengeId || null, now],
  );

  return { token, name: finalName, challengeId: challengeId || null, createdAt: now, used: false };
}

async function listInvites() {
  const { rows } = await pool.query(
    `SELECT token, name, challenge_id, created_at, used
       FROM invites
      ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({
    token: r.token,
    name: r.name,
    challengeId: r.challenge_id,
    createdAt: Number(r.created_at),
    used: r.used,
  }));
}

async function resolveInvite(token) {
  const { rows } = await pool.query(
    `SELECT token, name, challenge_id, used FROM invites WHERE token = $1`,
    [token],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    token: r.token,
    name: r.name,
    challengeId: r.challenge_id,
    used: r.used,
  };
}

async function markUsed(token) {
  await pool.query(`UPDATE invites SET used = true WHERE token = $1`, [token]);
}

module.exports = { createInvite, listInvites, resolveInvite, markUsed };
