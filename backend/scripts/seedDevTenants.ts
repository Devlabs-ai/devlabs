#!/usr/bin/env node
'use strict';

require('dotenv').config({ override: true });

const { seedDevTenants, seedDevTenantsIfEmpty, devSeedingEnabled } = require('../auth/seeds/runDevTenantSeed');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  if (!devSeedingEnabled() && !force) {
    console.error('[dev-tenant-seed] refused: production (use --force to override)');
    process.exit(1);
  }

  if (dryRun) {
    await seedDevTenants({ dryRun: true });
    return;
  }

  if (force) {
    await seedDevTenants();
    return;
  }

  await seedDevTenantsIfEmpty();
}

main().catch((e: Error) => {
  console.error('[dev-tenant-seed] failed:', e.message);
  process.exit(1);
});
