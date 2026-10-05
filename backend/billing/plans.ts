'use strict';

export type PlanId = 'linux' | 'docker' | 'kubernetes' | 'devops-engineer';

export interface BillingPlan {
  id: PlanId;
  name: string;
  /** Monthly price in INR. Must match the Razorpay plan amount. */
  price: number;
  /** Track ids this plan unlocks. */
  covers: PlanId[];
  envKey: string;
}

const PLANS: BillingPlan[] = [
  { id: 'linux', name: 'Linux', price: 199, covers: ['linux'], envKey: 'RAZORPAY_PLAN_LINUX' },
  { id: 'docker', name: 'Docker', price: 249, covers: ['docker'], envKey: 'RAZORPAY_PLAN_DOCKER' },
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    price: 399,
    covers: ['kubernetes'],
    envKey: 'RAZORPAY_PLAN_KUBERNETES',
  },
  {
    id: 'devops-engineer',
    name: 'DevOps Engineer',
    price: 699,
    covers: ['devops-engineer', 'linux', 'docker', 'kubernetes'],
    envKey: 'RAZORPAY_PLAN_DEVOPS',
  },
];

function listPlans(): BillingPlan[] {
  return PLANS;
}

function getPlan(id: string): BillingPlan | null {
  return PLANS.find((p) => p.id === id) || null;
}

function razorpayPlanId(plan: BillingPlan): string {
  return String(process.env[plan.envKey] || '').trim();
}

/** Launch offer: percent off the first month for subscriptions created before LAUNCH_OFFER_ENDS_AT. */
function launchOffer(): { percentOff: number; endsAt: number } | null {
  const percentOff = parseInt(process.env.LAUNCH_OFFER_PERCENT || '40', 10);
  const endsAt = Date.parse(process.env.LAUNCH_OFFER_ENDS_AT || '2026-10-31T23:59:59+05:30');
  if (!percentOff || percentOff <= 0 || percentOff >= 100 || Number.isNaN(endsAt)) return null;
  if (Date.now() > endsAt) return null;
  return { percentOff, endsAt };
}

function offerPrice(price: number, percentOff: number): number {
  return Math.round(price * (1 - percentOff / 100));
}

module.exports = { listPlans, getPlan, razorpayPlanId, launchOffer, offerPrice };
