#!/usr/bin/env npx tsx
/**
 * Create the monthly Razorpay plans for every track and print the env lines to
 * paste into .env. Plans are per key (test vs live), so run once per mode.
 * Skips plans whose RAZORPAY_PLAN_* is already set.
 *
 *   npx tsx scripts/createRazorpayPlans.ts
 */
'use strict';

import type { BillingPlan } from '../billing/plans';

require('dotenv').config({ override: true });

const razorpay = require('../billing/razorpay');
const plans = require('../billing/plans');

async function main(): Promise<void> {
  if (!razorpay.configured()) {
    throw new Error('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env first');
  }
  const mode = String(process.env.RAZORPAY_KEY_ID).startsWith('rzp_live_') ? 'LIVE' : 'test';
  console.log(`Creating plans in Razorpay ${mode} mode...\n`);

  const lines: string[] = [];
  for (const plan of plans.listPlans() as BillingPlan[]) {
    const existing = plans.razorpayPlanId(plan);
    if (existing) {
      console.log(`${plan.name}: already set (${existing}), skipped`);
      lines.push(`${plan.envKey}=${existing}`);
      continue;
    }
    const created = await razorpay.createPlan({
      name: `DevSetu ${plan.name}`,
      amountPaise: plan.price * 100,
      description: `${plan.name} track, monthly`,
    });
    console.log(`${plan.name}: created ${created.id} (₹${plan.price}/month)`);
    lines.push(`${plan.envKey}=${created.id}`);
  }

  console.log('\nAdd to backend/.env:\n');
  console.log(lines.join('\n'));
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
