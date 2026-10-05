'use strict';

import type { RazorpayPayment, RazorpaySubscription } from './razorpay';
import type { PlanId } from './plans';

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { getPlan } = require('./plans');

export interface SubscriptionRow {
  id: string;
  userId: string;
  planId: PlanId;
  kind: 'subscription' | 'one_time';
  razorpaySubscriptionId: string | null;
  razorpayOrderId: string | null;
  razorpayPlanId: string | null;
  status: string;
  firstMonthAmountPaise: number;
  offerPercent: number;
  startAt: number | null;
  currentStart: number | null;
  currentEnd: number | null;
  paidUntil: number | null;
  cancelRequested: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PaymentRow {
  id: string;
  subscriptionId: string | null;
  planId: PlanId | null;
  razorpayPaymentId: string;
  amountPaise: number;
  currency: string;
  status: string;
  method: string | null;
  createdAt: number;
}

/** Razorpay is still retrying a failed renewal — keep access until it halts. */
const GRACE_STATUSES = new Set(['pending']);

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function secToMs(v: number | null | undefined): number | null {
  return typeof v === 'number' && v > 0 ? v * 1000 : null;
}

function mapSubscription(r: Record<string, unknown>): SubscriptionRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    planId: String(r.plan_id) as PlanId,
    kind: r.kind === 'one_time' ? 'one_time' : 'subscription',
    razorpaySubscriptionId: r.razorpay_subscription_id ? String(r.razorpay_subscription_id) : null,
    razorpayOrderId: r.razorpay_order_id ? String(r.razorpay_order_id) : null,
    razorpayPlanId: r.razorpay_plan_id ? String(r.razorpay_plan_id) : null,
    status: String(r.status),
    firstMonthAmountPaise: Number(r.first_month_amount_paise),
    offerPercent: Number(r.offer_percent),
    startAt: num(r.start_at),
    currentStart: num(r.current_start),
    currentEnd: num(r.current_end),
    paidUntil: num(r.paid_until),
    cancelRequested: Boolean(r.cancel_requested),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function isEntitled(sub: SubscriptionRow, now = Date.now()): boolean {
  if (sub.paidUntil && sub.paidUntil > now) return true;
  return GRACE_STATUSES.has(sub.status);
}

async function insertSubscription(params: {
  userId: string;
  planId: PlanId;
  razorpay: RazorpaySubscription;
  firstMonthAmountPaise: number;
  offerPercent: number;
}): Promise<SubscriptionRow> {
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO subscriptions (
       id, user_id, plan_id, razorpay_subscription_id, razorpay_plan_id, status,
       first_month_amount_paise, offer_percent, start_at, current_start, current_end,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     RETURNING *`,
    [
      uuidv4(),
      params.userId,
      params.planId,
      params.razorpay.id,
      params.razorpay.plan_id,
      params.razorpay.status,
      params.firstMonthAmountPaise,
      params.offerPercent,
      secToMs(params.razorpay.start_at),
      secToMs(params.razorpay.current_start),
      secToMs(params.razorpay.current_end),
      now,
    ],
  );
  return mapSubscription(rows[0]);
}

async function insertOneTimePass(params: {
  userId: string;
  planId: PlanId;
  razorpayOrderId: string;
  amountPaise: number;
  offerPercent: number;
}): Promise<SubscriptionRow> {
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO subscriptions (
       id, user_id, plan_id, kind, razorpay_order_id, status,
       first_month_amount_paise, offer_percent, created_at, updated_at
     ) VALUES ($1, $2, $3, 'one_time', $4, 'created', $5, $6, $7, $7)
     RETURNING *`,
    [uuidv4(), params.userId, params.planId, params.razorpayOrderId, params.amountPaise, params.offerPercent, now],
  );
  return mapSubscription(rows[0]);
}

async function findByOrderId(razorpayOrderId: string): Promise<SubscriptionRow | null> {
  const { rows } = await pool.query(`SELECT * FROM subscriptions WHERE razorpay_order_id = $1`, [
    razorpayOrderId,
  ]);
  return rows[0] ? mapSubscription(rows[0]) : null;
}

/**
 * Mark a one-time pass paid and grant one month, starting where the user's
 * existing access to the same plan ends. Only the first caller (Checkout
 * verify or webhook) wins, so a month is never granted twice.
 */
async function markOneTimePaid(id: string): Promise<SubscriptionRow | null> {
  const now = Date.now();
  const { rows } = await pool.query(
    `WITH target AS (
       SELECT s.id,
              GREATEST($2::bigint, COALESCE((
                SELECT MAX(o.paid_until) FROM subscriptions o
                 WHERE o.user_id = s.user_id AND o.plan_id = s.plan_id AND o.id <> s.id
              ), 0)) AS starts
         FROM subscriptions s
        WHERE s.id = $1 AND s.kind = 'one_time' AND s.status = 'created'
     )
     UPDATE subscriptions u SET
       status = 'paid',
       current_start = t.starts,
       current_end = (EXTRACT(EPOCH FROM (to_timestamp(t.starts / 1000.0) + INTERVAL '1 month')) * 1000)::bigint,
       paid_until = (EXTRACT(EPOCH FROM (to_timestamp(t.starts / 1000.0) + INTERVAL '1 month')) * 1000)::bigint,
       updated_at = $2
       FROM target t
      WHERE u.id = t.id
      RETURNING u.*`,
    [id, now],
  );
  return rows[0] ? mapSubscription(rows[0]) : null;
}

async function findByRazorpayId(razorpaySubscriptionId: string): Promise<SubscriptionRow | null> {
  const { rows } = await pool.query(
    `SELECT * FROM subscriptions WHERE razorpay_subscription_id = $1`,
    [razorpaySubscriptionId],
  );
  return rows[0] ? mapSubscription(rows[0]) : null;
}

async function listForUser(userId: string): Promise<SubscriptionRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(mapSubscription);
}

async function hasPaidBefore(userId: string, planId: PlanId): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM subscriptions WHERE user_id = $1 AND plan_id = $2 AND paid_until IS NOT NULL LIMIT 1`,
    [userId, planId],
  );
  return rows.length > 0;
}

/** Copy status and billing periods from Razorpay. Never shortens paid_until. */
async function syncFromRazorpay(sub: RazorpaySubscription): Promise<SubscriptionRow | null> {
  const { rows } = await pool.query(
    `UPDATE subscriptions SET
       status = $2,
       start_at = COALESCE($3, start_at),
       current_start = COALESCE($4, current_start),
       current_end = COALESCE($5, current_end),
       updated_at = $6
     WHERE razorpay_subscription_id = $1
     RETURNING *`,
    [
      sub.id,
      sub.status,
      secToMs(sub.start_at),
      secToMs(sub.current_start),
      secToMs(sub.current_end),
      Date.now(),
    ],
  );
  return rows[0] ? mapSubscription(rows[0]) : null;
}

async function extendPaidUntil(subscriptionId: string, untilMs: number | null): Promise<void> {
  if (!untilMs) return;
  await pool.query(
    `UPDATE subscriptions
        SET paid_until = GREATEST(COALESCE(paid_until, 0), $2), updated_at = $3
      WHERE id = $1`,
    [subscriptionId, untilMs, Date.now()],
  );
}

async function markCancelRequested(subscriptionId: string): Promise<void> {
  await pool.query(
    `UPDATE subscriptions SET cancel_requested = true, updated_at = $2 WHERE id = $1`,
    [subscriptionId, Date.now()],
  );
}

/** Returns true when the payment was new (not already recorded). */
async function recordPayment(params: {
  userId: string;
  subscriptionId: string | null;
  payment: RazorpayPayment;
}): Promise<boolean> {
  const p = params.payment;
  const { rowCount } = await pool.query(
    `INSERT INTO payments (
       id, user_id, subscription_id, razorpay_payment_id, razorpay_invoice_id,
       amount_paise, currency, status, method, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (razorpay_payment_id) DO UPDATE SET status = EXCLUDED.status`,
    [
      uuidv4(),
      params.userId,
      params.subscriptionId,
      p.id,
      p.invoice_id || null,
      p.amount,
      p.currency || 'INR',
      p.status,
      p.method || null,
      secToMs(p.created_at) || Date.now(),
    ],
  );
  return (rowCount || 0) > 0;
}

async function listPaymentsForUser(userId: string, limit = 50): Promise<PaymentRow[]> {
  const { rows } = await pool.query(
    `SELECT p.*, s.plan_id
       FROM payments p
       LEFT JOIN subscriptions s ON s.id = p.subscription_id
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    subscriptionId: r.subscription_id ? String(r.subscription_id) : null,
    planId: r.plan_id ? (String(r.plan_id) as PlanId) : null,
    razorpayPaymentId: String(r.razorpay_payment_id),
    amountPaise: Number(r.amount_paise),
    currency: String(r.currency),
    status: String(r.status),
    method: r.method ? String(r.method) : null,
    createdAt: Number(r.created_at),
  }));
}

/** Returns true the first time an event id is seen. */
async function recordEvent(eventId: string, type: string, payload: unknown): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO billing_events (event_id, type, payload, received_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, type, JSON.stringify(payload), Date.now()],
  );
  return (rowCount || 0) > 0;
}

async function forgetEvent(eventId: string): Promise<void> {
  await pool.query(`DELETE FROM billing_events WHERE event_id = $1`, [eventId]);
}

/** Track ids the user can access right now (DevOps Engineer expands to its subtracks). */
async function getEntitlements(userId: string): Promise<PlanId[]> {
  const subs = await listForUser(userId);
  const out = new Set<PlanId>();
  for (const s of subs) {
    if (!isEntitled(s)) continue;
    for (const id of getPlan(s.planId)?.covers || []) out.add(id);
  }
  return [...out];
}

module.exports = {
  isEntitled,
  insertSubscription,
  insertOneTimePass,
  findByOrderId,
  markOneTimePaid,
  findByRazorpayId,
  listForUser,
  hasPaidBefore,
  syncFromRazorpay,
  extendPaidUntil,
  markCancelRequested,
  recordPayment,
  listPaymentsForUser,
  recordEvent,
  forgetEvent,
  getEntitlements,
};
