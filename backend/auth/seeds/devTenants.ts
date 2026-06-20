'use strict';

import type { AuthRole } from '../../types/domain';

export interface DevTenantUserSeed {
  email: string;
  role: AuthRole;
  name: string;
}

export interface DevTenantSeed {
  company: {
    name: string;
    domain: string;
    plan: 'starter' | 'pro' | 'enterprise';
  };
  users: DevTenantUserSeed[];
}

/** Shared dev tenants — insert-only when the companies table is empty. */
export const DEV_TENANTS: DevTenantSeed[] = [
  {
    company: {
      name: 'Devlabs',
      domain: 'devlabs.app',
      plan: 'enterprise',
    },
    users: [
      {
        email: 'admin@devlabs.app',
        role: 'admin',
        name: 'Dev Admin',
      },
      {
        email: 'interviewer@devlabs.app',
        role: 'interviewer',
        name: 'Dev Interviewer',
      },
    ],
  },
];
