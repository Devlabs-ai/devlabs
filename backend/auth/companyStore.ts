'use strict';

/** Users helpers (email identity only). */

import type { UserRecord } from '../types/domain';

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');

function mapUser(row: Record<string, unknown> | null | undefined): UserRecord | null {
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: (row.name as string | null) || null,
  };
}

async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const { rows } = await pool.query(
    `SELECT id, email, name, created_at, last_login_at
       FROM users WHERE email = $1`,
    [email.toLowerCase().trim()],
  );
  return mapUser(rows[0]);
}

async function findUserById(id: string): Promise<UserRecord | null> {
  const { rows } = await pool.query(
    `SELECT id, email, name FROM users WHERE id = $1`,
    [id],
  );
  return mapUser(rows[0]);
}

async function upsertUser({
  email,
  name = null,
}: {
  email: string;
  name?: string | null;
}): Promise<UserRecord> {
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, name, created_at, last_login_at)
     VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (email) DO UPDATE
       SET last_login_at = $4,
           name = COALESCE(EXCLUDED.name, users.name)
     RETURNING id, email, name`,
    [uuidv4(), email.toLowerCase().trim(), name, now],
  );
  const user = mapUser(rows[0]);
  if (!user) throw new Error('failed to upsert user');
  return user;
}

async function updateLastLogin(userId: string): Promise<void> {
  await pool.query(`UPDATE users SET last_login_at = $1 WHERE id = $2`, [Date.now(), userId]);
}

module.exports = {
  findUserByEmail,
  findUserById,
  upsertUser,
  updateLastLogin,
};
