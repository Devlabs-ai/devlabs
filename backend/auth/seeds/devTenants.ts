'use strict';

export interface DevTenantUserSeed {
  email: string;
  name: string;
}

export interface DevTenantSeed {
  users: DevTenantUserSeed[];
}

/** Legacy stub — company/tenant seeding disabled. */
export const DEV_TENANTS: DevTenantSeed[] = [];
