'use strict';

/** Users helpers (email + password / Google identity). */

import type { UserRecord } from '../types/domain';

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const {
  parseUserRole,
  reviewTracksForRole,
  roleImpliesAdmin,
} = require('./roles');

const BCRYPT_ROUNDS = 10;

export type UserStatus = 'pending' | 'active' | 'rejected';
export type UserRole = 'admin' | 'reviewer' | 'learner';

export interface AuthUser extends UserRecord {
  status: UserStatus;
  role: UserRole;
  reviewTracks: string[];
  isAdmin: boolean;
  passwordHash?: string | null;
  googleSub?: string | null;
}

function mapReviewTracks(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapUser(row: Record<string, unknown> | null | undefined): AuthUser | null {
  if (!row) return null;
  const role = parseUserRole(row.role, row.is_admin ? 'admin' : 'learner') as UserRole;
  const reviewTracks = reviewTracksForRole(role, mapReviewTracks(row.review_tracks));
  return {
    id: String(row.id),
    email: String(row.email),
    name: (row.name as string | null) || null,
    status: (String(row.status || 'pending') as UserStatus),
    role,
    reviewTracks,
    isAdmin: Boolean(row.is_admin) || roleImpliesAdmin(role),
  };
}

function mapUserWithHash(row: Record<string, unknown> | null | undefined): AuthUser | null {
  const user = mapUser(row);
  if (!user || !row) return null;
  return {
    ...user,
    passwordHash: (row.password_hash as string | null) || null,
    googleSub: (row.google_sub as string | null) || null,
  };
}

const USER_SELECT =
  'id, email, name, status, role, review_tracks, is_admin, password_hash, google_sub, created_at, last_login_at';
const USER_SELECT_PUBLIC =
  'id, email, name, status, role, review_tracks, is_admin';

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password: string, passwordHash: string | null | undefined): Promise<boolean> {
  if (!passwordHash) return false;
  return bcrypt.compare(password, passwordHash);
}

async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const { rows } = await pool.query(
    `SELECT ${USER_SELECT} FROM users WHERE email = $1`,
    [email.toLowerCase().trim()],
  );
  return mapUserWithHash(rows[0]);
}

async function findUserByGoogleSub(googleSub: string): Promise<AuthUser | null> {
  const { rows } = await pool.query(
    `SELECT ${USER_SELECT} FROM users WHERE google_sub = $1`,
    [googleSub],
  );
  return mapUserWithHash(rows[0]);
}

async function findUserById(id: string): Promise<AuthUser | null> {
  const { rows } = await pool.query(
    `SELECT ${USER_SELECT_PUBLIC} FROM users WHERE id = $1`,
    [id],
  );
  return mapUser(rows[0]);
}

async function createUser({
  email,
  passwordHash = null,
  status,
  name = null,
  role = 'learner',
  reviewTracks = [],
  googleSub = null,
}: {
  email: string;
  passwordHash?: string | null;
  status: UserStatus;
  name?: string | null;
  role?: UserRole;
  reviewTracks?: string[];
  googleSub?: string | null;
  /** @deprecated use role */
  isAdmin?: boolean;
}): Promise<AuthUser> {
  const now = Date.now();
  const resolvedRole = parseUserRole(role, 'learner') as UserRole;
  const tracks = reviewTracksForRole(resolvedRole, reviewTracks);
  const isAdmin = roleImpliesAdmin(resolvedRole);
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, name, created_at, last_login_at, password_hash, status, is_admin, role, review_tracks, google_sub)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9::jsonb, $10)
     RETURNING ${USER_SELECT_PUBLIC}`,
    [
      uuidv4(),
      email.toLowerCase().trim(),
      name,
      now,
      passwordHash,
      status,
      isAdmin,
      resolvedRole,
      JSON.stringify(tracks),
      googleSub,
    ],
  );
  const user = mapUser(rows[0]);
  if (!user) throw new Error('failed to create user');
  return user;
}

/** Link Google identity to an existing email account (same email = same user). */
async function linkGoogleAccount({
  userId,
  googleSub,
  name,
}: {
  userId: string;
  googleSub: string;
  name?: string | null;
}): Promise<AuthUser> {
  const { rows } = await pool.query(
    `UPDATE users
        SET google_sub = $1,
            name = COALESCE(NULLIF($2, ''), name)
      WHERE id = $3
      RETURNING ${USER_SELECT_PUBLIC}`,
    [googleSub, name || null, userId],
  );
  const user = mapUser(rows[0]);
  if (!user) throw new Error('failed to link Google account');
  return user;
}

async function updateUserAuth({
  userId,
  passwordHash,
  status,
}: {
  userId: string;
  passwordHash: string;
  status: UserStatus;
}): Promise<AuthUser> {
  const { rows } = await pool.query(
    `UPDATE users
        SET password_hash = $1,
            status = $2
      WHERE id = $3
      RETURNING ${USER_SELECT_PUBLIC}`,
    [passwordHash, status, userId],
  );
  const user = mapUser(rows[0]);
  if (!user) throw new Error('failed to update user');
  return user;
}

async function setUserStatus(userId: string, status: UserStatus): Promise<AuthUser | null> {
  const { rows } = await pool.query(
    `UPDATE users SET status = $1 WHERE id = $2
     RETURNING ${USER_SELECT_PUBLIC}`,
    [status, userId],
  );
  return mapUser(rows[0]);
}

async function setUserRole({
  userId,
  role,
  reviewTracks = [],
}: {
  userId: string;
  role: UserRole;
  reviewTracks?: string[];
}): Promise<AuthUser | null> {
  const resolvedRole = parseUserRole(role, 'learner') as UserRole;
  const tracks = reviewTracksForRole(resolvedRole, reviewTracks);
  const isAdmin = roleImpliesAdmin(resolvedRole);
  const { rows } = await pool.query(
    `UPDATE users
        SET role = $1,
            review_tracks = $2::jsonb,
            is_admin = $3
      WHERE id = $4
      RETURNING ${USER_SELECT_PUBLIC}`,
    [resolvedRole, JSON.stringify(tracks), isAdmin, userId],
  );
  return mapUser(rows[0]);
}

async function approveUser({
  userId,
  role = 'learner',
  reviewTracks = [],
}: {
  userId: string;
  role?: UserRole;
  reviewTracks?: string[];
}): Promise<AuthUser | null> {
  const resolvedRole = parseUserRole(role, 'learner') as UserRole;
  const tracks = reviewTracksForRole(resolvedRole, reviewTracks);
  const isAdmin = roleImpliesAdmin(resolvedRole);
  const { rows } = await pool.query(
    `UPDATE users
        SET status = 'active',
            role = $1,
            review_tracks = $2::jsonb,
            is_admin = $3
      WHERE id = $4
      RETURNING ${USER_SELECT_PUBLIC}`,
    [resolvedRole, JSON.stringify(tracks), isAdmin, userId],
  );
  return mapUser(rows[0]);
}

async function listUsers(status?: UserStatus | null): Promise<AuthUser[]> {
  if (status) {
    const { rows } = await pool.query(
      `SELECT ${USER_SELECT_PUBLIC}, created_at, last_login_at
         FROM users
        WHERE status = $1
        ORDER BY created_at DESC`,
      [status],
    );
    return rows.map((r: Record<string, unknown>) => mapUser(r)!).filter(Boolean);
  }
  const { rows } = await pool.query(
    `SELECT ${USER_SELECT_PUBLIC}, created_at, last_login_at
       FROM users
      ORDER BY created_at DESC`,
  );
  return rows.map((r: Record<string, unknown>) => mapUser(r)!).filter(Boolean);
}

async function updateLastLogin(userId: string): Promise<void> {
  await pool.query(`UPDATE users SET last_login_at = $1 WHERE id = $2`, [Date.now(), userId]);
}

module.exports = {
  hashPassword,
  verifyPassword,
  findUserByEmail,
  findUserByGoogleSub,
  findUserById,
  createUser,
  linkGoogleAccount,
  updateUserAuth,
  setUserStatus,
  setUserRole,
  approveUser,
  listUsers,
  updateLastLogin,
};
