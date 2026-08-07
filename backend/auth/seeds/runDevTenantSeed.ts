'use strict';

/** Dev tenant seeding disabled — companies / multi-tenant deferred. */

async function seedDevTenants(): Promise<{ companies: number; users: number }> {
  return { companies: 0, users: 0 };
}

async function seedDevTenantsIfEmpty({
  onLog = console.log,
}: {
  onLog?: (msg: string) => void;
} = {}): Promise<number> {
  onLog('[dev-tenant-seed] skipped (companies removed until platform ready)');
  return 0;
}

function devSeedingEnabled(): boolean {
  return false;
}

module.exports = {
  seedDevTenants,
  seedDevTenantsIfEmpty,
  DEV_TENANTS: [],
  devSeedingEnabled,
};
