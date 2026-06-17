'use strict';

// DB helpers for companies, users, and libraries.

import type { AuthRole, UserRecord } from '../types/domain';

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

interface CompanyRow {
  id: string;
  name: string;
  domain: string;
  plan: string;
  subscription_end: number | null;
  is_active: boolean;
}

async function findCompanyByDomain(domain: string): Promise<CompanyRow | null> {
  const { rows } = await pool.query(
    `SELECT id, name, domain, plan, subscription_end, is_active FROM companies WHERE domain = $1`,
    [domain.toLowerCase().trim()],
  );
  return rows[0] || null;
}

async function findCompanyById(id: string): Promise<CompanyRow | null> {
  const { rows } = await pool.query(
    `SELECT id, name, domain, plan, subscription_end, is_active FROM companies WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

// Lazily deactivate a company whose subscription has expired.
async function checkAndDeactivate(company: CompanyRow): Promise<CompanyRow> {
  if (!company.is_active) return company;
  if (!company.subscription_end) return company;
  if (Date.now() < Number(company.subscription_end)) return company;

  await pool.query(`UPDATE companies SET is_active = false WHERE id = $1`, [company.id]);
  return { ...company, is_active: false };
}

async function createCompany({
  name,
  domain,
  plan = 'starter',
  subscriptionEnd = null,
}: {
  name: string;
  domain: string;
  plan?: string;
  subscriptionEnd?: number | null;
}): Promise<CompanyRow> {
  const id = uuidv4();
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO companies (id, name, domain, plan, subscription_end, is_active, created_at)
     VALUES ($1,$2,$3,$4,$5,true,$6)
     RETURNING id, name, domain, plan, subscription_end, is_active`,
    [id, name, domain.toLowerCase().trim(), plan, subscriptionEnd || null, now],
  );
  // Seed a private library for the new company
  await createLibrary({ companyId: id, name: `${name} Library` });
  return rows[0];
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const { rows } = await pool.query(
    `SELECT id, email, company_id, role, name, created_at, last_login_at
       FROM users WHERE email = $1`,
    [email.toLowerCase().trim()],
  );
  return rows[0] || null;
}

async function findUserById(id: string): Promise<UserRecord | null> {
  const { rows } = await pool.query(
    `SELECT id, email, company_id, role, name FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function upsertUser({
  email,
  companyId,
  role = 'interviewer',
  name = null,
}: {
  email: string;
  companyId: string;
  role?: AuthRole;
  name?: string | null;
}): Promise<UserRecord> {
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, company_id, role, name, created_at, last_login_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT (email) DO UPDATE
       SET last_login_at = $6,
           role = COALESCE(EXCLUDED.role, users.role),
           name = COALESCE(EXCLUDED.name, users.name)
     RETURNING id, email, company_id, role, name`,
    [uuidv4(), email.toLowerCase().trim(), companyId, role, name, now],
  );
  return rows[0];
}

async function updateLastLogin(userId: string): Promise<void> {
  await pool.query(`UPDATE users SET last_login_at = $1 WHERE id = $2`, [Date.now(), userId]);
}

// ---------------------------------------------------------------------------
// Libraries
// ---------------------------------------------------------------------------

interface LibraryRow {
  id: string;
  company_id: string | null;
  name: string;
}

async function createLibrary({
  companyId = null,
  name,
}: {
  companyId?: string | null;
  name: string;
}): Promise<LibraryRow | null> {
  const id = uuidv4();
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO libraries (id, company_id, name, created_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING
     RETURNING id, company_id, name`,
    [id, companyId, name, now],
  );
  return rows[0] || null;
}

async function getLibraryForCompany(companyId: string | null | undefined): Promise<LibraryRow | null> {
  const { rows } = await pool.query(
    `SELECT id, company_id, name FROM libraries WHERE company_id = $1 LIMIT 1`,
    [companyId],
  );
  return rows[0] || null;
}

async function getPublicLibrary(): Promise<LibraryRow | null> {
  const { rows } = await pool.query(
    `SELECT id, company_id, name FROM libraries WHERE company_id IS NULL LIMIT 1`,
  );
  return rows[0] || null;
}

// Ensure the global public library exists (called at boot)
async function ensurePublicLibrary(): Promise<LibraryRow | null> {
  const existing = await getPublicLibrary();
  if (existing) return existing;
  return createLibrary({ companyId: null, name: 'Public Library' });
}

module.exports = {
  findCompanyByDomain,
  findCompanyById,
  checkAndDeactivate,
  createCompany,
  findUserByEmail,
  findUserById,
  upsertUser,
  updateLastLogin,
  createLibrary,
  getLibraryForCompany,
  getPublicLibrary,
  ensurePublicLibrary,
};
