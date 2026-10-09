'use strict';

const crypto = require('crypto');

const API_BASE = 'https://api.razorpay.com/v1';

export interface RazorpaySubscription {
  id: string;
  plan_id: string;
  status: string;
  current_start: number | null;
  current_end: number | null;
  start_at: number | null;
  charge_at: number | null;
  short_url?: string;
  notes?: Record<string, string>;
}

export interface RazorpayPayment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  invoice_id?: string | null;
  order_id?: string | null;
  created_at: number;
}

function keyId(): string {
  return String(process.env.RAZORPAY_KEY_ID || '').trim();
}

function keySecret(): string {
  return String(process.env.RAZORPAY_KEY_SECRET || '').trim();
}

function configured(): boolean {
  return Boolean(keyId() && keySecret());
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!configured()) throw Object.assign(new Error('Razorpay keys are not configured'), { status: 503 });
  const auth = Buffer.from(`${keyId()}:${keySecret()}`).toString('base64');
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string | { description?: string; code?: string };
  };
  if (!res.ok) {
    const detail = typeof data?.error === 'string' ? data.error : data?.error?.description;
    let msg = `Razorpay ${method} ${path} failed (${res.status}${detail ? `: ${detail}` : ''})`;
    if (res.status === 401 && /^\/(plans|subscriptions)/.test(path)) {
      msg += '. If other Razorpay APIs work with these keys, enable Subscriptions in the Razorpay Dashboard.';
    }
    console.error('[razorpay]', method, path, res.status, data?.error);
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return data as T;
}

function createSubscription(params: {
  planId: string;
  totalCount: number;
  startAt?: number;
  upfrontAmountPaise?: number;
  upfrontLabel?: string;
  notes?: Record<string, string>;
}): Promise<RazorpaySubscription> {
  const body: Record<string, unknown> = {
    plan_id: params.planId,
    total_count: params.totalCount,
    customer_notify: 1,
    notes: params.notes || {},
  };
  if (params.startAt) body.start_at = params.startAt;
  if (params.upfrontAmountPaise) {
    body.addons = [
      {
        item: {
          name: params.upfrontLabel || 'First month',
          amount: params.upfrontAmountPaise,
          currency: 'INR',
        },
      },
    ];
  }
  return request<RazorpaySubscription>('POST', '/subscriptions', body);
}

function fetchSubscription(id: string): Promise<RazorpaySubscription> {
  return request<RazorpaySubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`);
}

function cancelSubscription(id: string, atCycleEnd: boolean): Promise<RazorpaySubscription> {
  return request<RazorpaySubscription>('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, {
    cancel_at_cycle_end: atCycleEnd ? 1 : 0,
  });
}

function fetchPayment(id: string): Promise<RazorpayPayment> {
  return request<RazorpayPayment>('GET', `/payments/${encodeURIComponent(id)}`);
}

function capturePayment(id: string, amountPaise: number): Promise<RazorpayPayment> {
  return request<RazorpayPayment>('POST', `/payments/${encodeURIComponent(id)}/capture`, {
    amount: amountPaise,
    currency: 'INR',
  });
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

function fetchOrder(id: string): Promise<RazorpayOrder> {
  return request<RazorpayOrder>('GET', `/orders/${encodeURIComponent(id)}`);
}

function createOrder(params: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  return request<RazorpayOrder>('POST', '/orders', {
    amount: params.amountPaise,
    currency: 'INR',
    receipt: params.receipt.slice(0, 40),
    notes: params.notes || {},
  });
}

function createPlan(params: {
  name: string;
  amountPaise: number;
  description?: string;
}): Promise<{ id: string }> {
  return request<{ id: string }>('POST', '/plans', {
    period: 'monthly',
    interval: 1,
    item: {
      name: params.name,
      amount: params.amountPaise,
      currency: 'INR',
      description: params.description || '',
    },
  });
}

function safeEqualHex(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(actual || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Signature Checkout returns after a subscription payment succeeds. */
function verifyCheckoutSignature(paymentId: string, subscriptionId: string, signature: string): boolean {
  if (!keySecret()) return false;
  const expected = crypto
    .createHmac('sha256', keySecret())
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

/** Signature Checkout returns after an order payment succeeds (note: order first). */
function verifyOrderSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!keySecret()) return false;
  const expected = crypto
    .createHmac('sha256', keySecret())
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

module.exports = {
  keyId,
  configured,
  createSubscription,
  fetchSubscription,
  cancelSubscription,
  fetchPayment,
  capturePayment,
  fetchOrder,
  createOrder,
  createPlan,
  verifyCheckoutSignature,
  verifyOrderSignature,
  verifyWebhookSignature,
};
