'use strict';

const pool = require('../../db/pool');
const { createCompany, upsertUser } = require('../companyStore');
const { DEV_TENANTS } = require('./devTenants');

function devSeedingEnabled(): boolean {
  if (process.env.SEED_DEV_TENANTS === 'true') return true;
  if (process.env.SEED_DEV_TENANTS === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

async function countCompanies(): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM companies`);
  return rows[0]?.count ?? 0;
}

async function seedDevTenants({
  dryRun = false,
  onLog = console.log,
}: {
  dryRun?: boolean;
  onLog?: (msg: string) => void;
} = {}): Promise<{ companies: number; users: number }> {
  let companies = 0;
  let users = 0;

  for (let i = 0; i < DEV_TENANTS.length; i++) {
    const tenant = DEV_TENANTS[i];
    const prefix = `[dev-tenant-seed] (${i + 1}/${DEV_TENANTS.length}) ${tenant.company.domain}`;

    if (dryRun) {
      onLog(`${prefix}: would create company + ${tenant.users.length} user(s)`);
      companies++;
      users += tenant.users.length;
      continue;
    }

    const company = await createCompany({
      name: tenant.company.name,
      domain: tenant.company.domain,
      plan: tenant.company.plan,
    });
    companies++;
    onLog(`${prefix}: created company "${company.name}"`);

    for (const user of tenant.users) {
      await upsertUser({
        email: user.email,
        companyId: company.id,
        role: user.role,
        name: user.name,
      });
      users++;
      onLog(`${prefix}: upserted user ${user.email} (${user.role})`);
    }
  }

  return { companies, users };
}

/** Seed shared dev tenants only when companies is empty (fresh local DB). */
async function seedDevTenantsIfEmpty({
  onLog = console.log,
}: {
  onLog?: (msg: string) => void;
} = {}): Promise<number> {
  if (!devSeedingEnabled()) {
    onLog('[dev-tenant-seed] skipped (production — set SEED_DEV_TENANTS=true to override)');
    return 0;
  }

  const total = await countCompanies();
  if (total > 0) {
    onLog(`[dev-tenant-seed] companies has ${total} row(s) — skipping`);
    return 0;
  }

  onLog('[dev-tenant-seed] companies is empty — seeding from auth/seeds/devTenants.ts...');
  const { companies, users } = await seedDevTenants({ onLog });
  onLog(`[dev-tenant-seed] done — ${companies} company(ies), ${users} user(s)`);
  return companies;
}

module.exports = { seedDevTenants, seedDevTenantsIfEmpty, DEV_TENANTS, devSeedingEnabled };
