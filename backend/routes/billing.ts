'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';
import type { RazorpayOrder, RazorpayPayment, RazorpaySubscription } from '../billing/razorpay';
import type { SubscriptionRow } from '../billing/store';

const express = require('express');
const { requireInterviewer } = require('../auth/middleware');
const razorpay = require('../billing/razorpay');
const plans = require('../billing/plans');
const store = require('../billing/store');

const router = express.Router();

const MAX_MONTHLY_CYCLES = 120;
/** Unpaid checkouts younger than this are reused instead of creating another subscription. */
const REUSE_CREATED_MS = 30 * 60 * 1000;
const CANCELLABLE_STATUSES = new Set(['authenticated', 'active', 'pending']);

function billingEnabled(): boolean {
  return String(process.env.BILLING_ENABLED || '').toLowerCase() === 'true' && razorpay.configured();
}

/** 'one_time' sells one-month passes via Orders; 'subscription' uses Razorpay Subscriptions. */
function billingMode(): 'one_time' | 'subscription' {
  return String(process.env.BILLING_MODE || '').toLowerCase() === 'subscription' ? 'subscription' : 'one_time';
}

function userId(req: ExpressRequest): string {
  return String(req.user?.sub || req.user?.userId || '');
}

function secToMs(v: number | null | undefined): number | null {
  return typeof v === 'number' && v > 0 ? v * 1000 : null;
}

function oneMonthFromNowSec(): number {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return Math.floor(d.getTime() / 1000);
}

function isAbandoned(sub: SubscriptionRow, now: number): boolean {
  return sub.status === 'created' && now - sub.createdAt > REUSE_CREATED_MS;
}

function publicSubscription(sub: SubscriptionRow): Record<string, unknown> {
  return {
    id: sub.id,
    planId: sub.planId,
    planName: plans.getPlan(sub.planId)?.name || sub.planId,
    kind: sub.kind,
    status: sub.status,
    entitled: store.isEntitled(sub),
    firstMonthAmountPaise: sub.firstMonthAmountPaise,
    offerPercent: sub.offerPercent,
    monthlyAmountPaise: (plans.getPlan(sub.planId)?.price || 0) * 100,
    paidUntil: sub.paidUntil,
    nextChargeAt:
      sub.kind === 'one_time' || sub.cancelRequested ? null : sub.currentEnd || sub.startAt,
    cancelRequested: sub.cancelRequested,
    createdAt: sub.createdAt,
  };
}

async function billingSummary(uid: string): Promise<Record<string, unknown>> {
  const now = Date.now();
  const [subs, payments, entitlements] = await Promise.all([
    store.listForUser(uid),
    store.listPaymentsForUser(uid),
    store.getEntitlements(uid),
  ]);
  return {
    enabled: billingEnabled(),
    mode: billingMode(),
    entitlements,
    subscriptions: subs
      .filter((s: SubscriptionRow) => s.status !== 'created')
      .map(publicSubscription),
    payments,
    now,
  };
}

// GET /api/billing/config — public; drives the pricing page buttons.
router.get('/config', (_req: ExpressRequest, res: ExpressResponse) => {
  const offer = plans.launchOffer();
  res.json({
    enabled: billingEnabled(),
    mode: billingMode(),
    keyId: billingEnabled() ? razorpay.keyId() : null,
    offer,
    plans: plans.listPlans().map((p: { id: string; name: string; price: number; covers: string[] }) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      firstMonthPrice: offer ? plans.offerPrice(p.price, offer.percentOff) : p.price,
      covers: p.covers,
    })),
  });
});

// GET /api/billing/me
router.get('/me', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    res.json(await billingSummary(userId(req)));
  } catch (e) {
    next(e);
  }
});

// POST /api/billing/subscriptions  { planId }
router.post(
  '/subscriptions',
  requireInterviewer,
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      if (!billingEnabled()) return res.status(503).json({ error: 'Payments are not open yet' });
      if (billingMode() !== 'subscription') {
        return res.status(409).json({ error: 'Subscriptions are not enabled; use /api/billing/orders' });
      }
      const uid = userId(req);
      const plan = plans.getPlan(String((req.body as { planId?: string })?.planId || ''));
      if (!plan) return res.status(400).json({ error: 'Unknown plan' });
      const rzpPlanId = plans.razorpayPlanId(plan);
      if (!rzpPlanId) {
        console.error(`[billing] ${plan.envKey} is not set`);
        return res.status(503).json({ error: 'This plan is not available yet' });
      }

      const entitlements: string[] = await store.getEntitlements(uid);
      if (entitlements.includes(plan.id)) {
        return res.status(409).json({ error: `You already have access to ${plan.name}` });
      }

      const now = Date.now();
      const existing: SubscriptionRow[] = await store.listForUser(uid);
      const reusable = existing.find(
        (s) => s.planId === plan.id && s.status === 'created' && !isAbandoned(s, now),
      );

      let sub: SubscriptionRow = reusable as SubscriptionRow;
      if (!sub) {
        const offer = plans.launchOffer();
        const offerPercent = offer && !(await store.hasPaidBefore(uid, plan.id)) ? offer.percentOff : 0;
        const firstMonth = offerPercent ? plans.offerPrice(plan.price, offerPercent) : plan.price;
        // First month is charged upfront with the mandate; recurring charges start a month later.
        const created: RazorpaySubscription = await razorpay.createSubscription({
          planId: rzpPlanId,
          totalCount: MAX_MONTHLY_CYCLES,
          startAt: oneMonthFromNowSec(),
          upfrontAmountPaise: firstMonth * 100,
          upfrontLabel: offerPercent
            ? `${plan.name} first month (${offerPercent}% launch offer)`
            : `${plan.name} first month`,
          notes: { user_id: uid, plan_id: plan.id },
        });
        sub = await store.insertSubscription({
          userId: uid,
          planId: plan.id,
          razorpay: created,
          firstMonthAmountPaise: firstMonth * 100,
          offerPercent,
        });
      }

      res.json({
        keyId: razorpay.keyId(),
        razorpaySubscriptionId: sub.razorpaySubscriptionId,
        planName: plan.name,
        firstMonthAmountPaise: sub.firstMonthAmountPaise,
        offerPercent: sub.offerPercent,
        email: req.user?.email || '',
      });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/billing/subscriptions/verify  { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }
router.post(
  '/subscriptions/verify',
  requireInterviewer,
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const body = (req.body as Record<string, unknown>) || {};
      const paymentId = String(body.razorpay_payment_id || '');
      const rzpSubId = String(body.razorpay_subscription_id || '');
      const signature = String(body.razorpay_signature || '');
      if (!paymentId || !rzpSubId || !signature) {
        return res.status(400).json({ error: 'Missing payment details' });
      }

      const uid = userId(req);
      const sub: SubscriptionRow | null = await store.findByRazorpayId(rzpSubId);
      if (!sub || sub.userId !== uid) return res.status(404).json({ error: 'Subscription not found' });
      if (!razorpay.verifyCheckoutSignature(paymentId, rzpSubId, signature)) {
        return res.status(400).json({ error: 'Payment signature mismatch' });
      }

      const [payment, latest]: [RazorpayPayment, RazorpaySubscription] = await Promise.all([
        razorpay.fetchPayment(paymentId),
        razorpay.fetchSubscription(rzpSubId),
      ]);
      await store.recordPayment({ userId: uid, subscriptionId: sub.id, payment });
      const synced: SubscriptionRow | null = await store.syncFromRazorpay(latest);
      if (payment.status === 'captured' || payment.status === 'authorized') {
        await store.extendPaidUntil(sub.id, synced?.startAt || sub.startAt);
      }

      res.json(await billingSummary(uid));
    } catch (e) {
      next(e);
    }
  },
);

/** Capture if needed, record the payment, and grant the month. Safe to call more than once. */
async function fulfilOrder(pass: SubscriptionRow, payment: RazorpayPayment): Promise<void> {
  let p = payment;
  if (p.status === 'authorized') {
    p = await razorpay.capturePayment(p.id, pass.firstMonthAmountPaise);
  }
  await store.recordPayment({ userId: pass.userId, subscriptionId: pass.id, payment: p });
  if (p.status === 'captured') await store.markOneTimePaid(pass.id);
}

// POST /api/billing/orders  { planId } — one month of access, no auto-renew.
router.post('/orders', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    if (!billingEnabled()) return res.status(503).json({ error: 'Payments are not open yet' });
    if (billingMode() !== 'one_time') {
      return res.status(409).json({ error: 'One-time payments are not enabled; use /api/billing/subscriptions' });
    }
    const uid = userId(req);
    const plan = plans.getPlan(String((req.body as { planId?: string })?.planId || ''));
    if (!plan) return res.status(400).json({ error: 'Unknown plan' });

    const now = Date.now();
    const existing: SubscriptionRow[] = await store.listForUser(uid);
    const coveredByOther = existing.some(
      (s) =>
        store.isEntitled(s, now) &&
        s.planId !== plan.id &&
        (plans.getPlan(s.planId)?.covers || []).includes(plan.id),
    );
    if (coveredByOther) {
      return res.status(409).json({ error: `${plan.name} is already included in your plan` });
    }

    let pass: SubscriptionRow | undefined = existing.find(
      (s) => s.kind === 'one_time' && s.planId === plan.id && s.status === 'created' && !isAbandoned(s, now),
    );
    if (!pass) {
      const offer = plans.launchOffer();
      const offerPercent = offer && !(await store.hasPaidBefore(uid, plan.id)) ? offer.percentOff : 0;
      const amount = (offerPercent ? plans.offerPrice(plan.price, offerPercent) : plan.price) * 100;
      const order: RazorpayOrder = await razorpay.createOrder({
        amountPaise: amount,
        receipt: `${plan.id}-${now}`,
        notes: { user_id: uid, plan_id: plan.id },
      });
      pass = (await store.insertOneTimePass({
        userId: uid,
        planId: plan.id,
        razorpayOrderId: order.id,
        amountPaise: amount,
        offerPercent,
      })) as SubscriptionRow;
    }

    res.json({
      keyId: razorpay.keyId(),
      razorpayOrderId: pass.razorpayOrderId,
      amountPaise: pass.firstMonthAmountPaise,
      planName: plan.name,
      offerPercent: pass.offerPercent,
      email: req.user?.email || '',
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/billing/orders/verify  { razorpay_payment_id, razorpay_order_id, razorpay_signature }
router.post(
  '/orders/verify',
  requireInterviewer,
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const body = (req.body as Record<string, unknown>) || {};
      const paymentId = String(body.razorpay_payment_id || '');
      const orderId = String(body.razorpay_order_id || '');
      const signature = String(body.razorpay_signature || '');
      if (!paymentId || !orderId || !signature) {
        return res.status(400).json({ error: 'Missing payment details' });
      }

      const uid = userId(req);
      const pass: SubscriptionRow | null = await store.findByOrderId(orderId);
      if (!pass || pass.userId !== uid) return res.status(404).json({ error: 'Order not found' });
      if (!razorpay.verifyOrderSignature(orderId, paymentId, signature)) {
        return res.status(400).json({ error: 'Payment signature mismatch' });
      }

      const payment: RazorpayPayment = await razorpay.fetchPayment(paymentId);
      if (payment.order_id !== orderId) return res.status(400).json({ error: 'Payment does not match order' });
      await fulfilOrder(pass, payment);

      res.json(await billingSummary(uid));
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/billing/subscriptions/:id/cancel — access continues until paid_until.
router.post(
  '/subscriptions/:id/cancel',
  requireInterviewer,
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const uid = userId(req);
      const subs: SubscriptionRow[] = await store.listForUser(uid);
      const sub = subs.find((s) => s.id === String(req.params.id));
      if (!sub) return res.status(404).json({ error: 'Subscription not found' });
      if (sub.kind !== 'subscription' || !sub.razorpaySubscriptionId) {
        return res.status(409).json({ error: 'One-month passes do not renew, so there is nothing to cancel' });
      }
      if (sub.cancelRequested || !CANCELLABLE_STATUSES.has(sub.status)) {
        return res.status(409).json({ error: 'This subscription is not active' });
      }

      // Only an active cycle can end "at cycle end"; before the first recurring charge, or while
      // a renewal is failing, cancel right away (the prepaid first month is kept via paid_until).
      const updated: RazorpaySubscription = await razorpay.cancelSubscription(
        sub.razorpaySubscriptionId,
        sub.status === 'active',
      );
      await store.markCancelRequested(sub.id);
      await store.syncFromRazorpay(updated);

      res.json(await billingSummary(uid));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * POST /api/billing/webhook — mounted in server.ts with express.raw() ahead of
 * express.json(), because the signature covers the exact request bytes.
 */
async function webhookHandler(req: ExpressRequest, res: ExpressResponse): Promise<void> {
  const raw = req.body as Buffer;
  const signature = String(req.headers['x-razorpay-signature'] || '');
  if (!Buffer.isBuffer(raw) || !razorpay.verifyWebhookSignature(raw, signature)) {
    res.status(400).json({ error: 'invalid signature' });
    return;
  }

  let event: {
    event?: string;
    created_at?: number;
    payload?: {
      subscription?: { entity?: RazorpaySubscription };
      payment?: { entity?: RazorpayPayment };
    };
  };
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch (_e) {
    res.status(400).json({ error: 'invalid json' });
    return;
  }

  const type = String(event.event || '');
  const subEntity = event.payload?.subscription?.entity;
  const payEntity = event.payload?.payment?.entity;
  const eventId =
    String(req.headers['x-razorpay-event-id'] || '') ||
    `${type}:${subEntity?.id || payEntity?.id || ''}:${event.created_at || ''}`;

  if (!(await store.recordEvent(eventId, type, event).catch(() => false))) {
    res.json({ ok: true, duplicate: true });
    return;
  }

  try {
    // order.paid / payment.captured: fallback when the browser closes before /orders/verify.
    const orderId = payEntity?.order_id || '';
    if (orderId && (type === 'order.paid' || type === 'payment.captured')) {
      const pass: SubscriptionRow | null = await store.findByOrderId(orderId);
      if (pass) await fulfilOrder(pass, payEntity as RazorpayPayment);
      else console.warn(`[billing] webhook ${type} for unknown order ${orderId}`);
    }

    if (subEntity?.id) {
      const sub: SubscriptionRow | null = await store.findByRazorpayId(subEntity.id);
      if (!sub) {
        console.warn(`[billing] webhook ${type} for unknown subscription ${subEntity.id}`);
      } else {
        const synced: SubscriptionRow | null = await store.syncFromRazorpay(subEntity);
        if (payEntity?.id) {
          await store.recordPayment({ userId: sub.userId, subscriptionId: sub.id, payment: payEntity });
        }
        if (type === 'subscription.authenticated') {
          // The mandate is only authenticated once the upfront first-month payment succeeds.
          await store.extendPaidUntil(sub.id, synced?.startAt || secToMs(subEntity.start_at));
        } else if (type === 'subscription.charged') {
          await store.extendPaidUntil(sub.id, secToMs(subEntity.current_end));
        }
      }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(`[billing] webhook ${type} failed`, e);
    await store.forgetEvent(eventId).catch(() => {});
    res.status(500).json({ error: 'webhook processing failed' });
  }
}

module.exports = router;
module.exports.webhookHandler = webhookHandler;
