import axios from 'axios';
import { getAuthHeader } from './authApi';

export interface BillingPlanConfig {
  id: string;
  name: string;
  price: number;
  firstMonthPrice: number;
  covers: string[];
}

export type BillingMode = 'one_time' | 'subscription';

export interface BillingConfig {
  enabled: boolean;
  mode: BillingMode;
  keyId: string | null;
  offer: { percentOff: number; endsAt: number } | null;
  plans: BillingPlanConfig[];
}

export interface BillingSubscription {
  id: string;
  planId: string;
  planName: string;
  kind: 'subscription' | 'one_time';
  status: string;
  entitled: boolean;
  firstMonthAmountPaise: number;
  offerPercent: number;
  monthlyAmountPaise: number;
  paidUntil: number | null;
  nextChargeAt: number | null;
  cancelRequested: boolean;
  createdAt: number;
}

export interface BillingPayment {
  id: string;
  planId: string | null;
  razorpayPaymentId: string;
  amountPaise: number;
  currency: string;
  status: string;
  method: string | null;
  createdAt: number;
}

export interface BillingSummary {
  enabled: boolean;
  mode: BillingMode;
  entitlements: string[];
  subscriptions: BillingSubscription[];
  payments: BillingPayment[];
}

interface CheckoutSession {
  keyId: string;
  razorpaySubscriptionId: string;
  planName: string;
  firstMonthAmountPaise: number;
  offerPercent: number;
  email: string;
}

interface OrderSession {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  planName: string;
  offerPercent: number;
  email: string;
}

interface CheckoutSuccess {
  razorpay_payment_id: string;
  razorpay_subscription_id?: string;
  razorpay_order_id?: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, cb: (resp: { error?: { description?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let checkoutScript: Promise<void> | null = null;

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutScript) {
    checkoutScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CHECKOUT_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        checkoutScript = null;
        reject(new Error('Could not load Razorpay Checkout. Check your connection and try again.'));
      };
      document.body.appendChild(s);
    });
  }
  return checkoutScript;
}

export function apiErrorMessage(e: unknown, fallback: string): string {
  const data = (e as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error || (e as Error)?.message || fallback;
}

export async function fetchBillingConfig(): Promise<BillingConfig> {
  const { data } = await axios.get('/api/billing/config');
  return data as BillingConfig;
}

export async function fetchBillingSummary(): Promise<BillingSummary> {
  const { data } = await axios.get('/api/billing/me', { headers: getAuthHeader() });
  return data as BillingSummary;
}

export async function cancelSubscription(id: string): Promise<BillingSummary> {
  const { data } = await axios.post(
    `/api/billing/subscriptions/${encodeURIComponent(id)}/cancel`,
    {},
    { headers: getAuthHeader() },
  );
  return data as BillingSummary;
}

function runCheckout(options: Record<string, unknown>): Promise<CheckoutSuccess | null> {
  const Razorpay = window.Razorpay;
  if (!Razorpay) return Promise.reject(new Error('Razorpay Checkout is unavailable'));
  return new Promise<CheckoutSuccess | null>((resolve, reject) => {
    // Checkout stays open after a failed attempt so the user can retry; only
    // surface the failure if they give up and close it.
    let lastFailure: string | null = null;
    const rzp = new Razorpay({
      ...options,
      name: 'DevSetu',
      theme: { color: '#0f172a' },
      handler: (resp: CheckoutSuccess) => resolve(resp),
      modal: {
        ondismiss: () => (lastFailure ? reject(new Error(lastFailure)) : resolve(null)),
      },
    });
    rzp.on('payment.failed', (resp) => {
      lastFailure = resp.error?.description || 'Payment failed';
    });
    rzp.open();
  });
}

async function subscribe(planId: string): Promise<BillingSummary | null> {
  const [{ data }] = await Promise.all([
    axios.post('/api/billing/subscriptions', { planId }, { headers: getAuthHeader() }),
    loadCheckout(),
  ]);
  const session = data as CheckoutSession;
  const paid = await runCheckout({
    key: session.keyId,
    subscription_id: session.razorpaySubscriptionId,
    description: session.offerPercent
      ? `${session.planName}: first month ${session.offerPercent}% off`
      : `${session.planName} monthly`,
    prefill: { email: session.email },
  });
  if (!paid) return null;
  const { data: summary } = await axios.post('/api/billing/subscriptions/verify', paid, {
    headers: getAuthHeader(),
  });
  return summary as BillingSummary;
}

async function buyMonth(planId: string): Promise<BillingSummary | null> {
  const [{ data }] = await Promise.all([
    axios.post('/api/billing/orders', { planId }, { headers: getAuthHeader() }),
    loadCheckout(),
  ]);
  const session = data as OrderSession;
  const paid = await runCheckout({
    key: session.keyId,
    order_id: session.razorpayOrderId,
    amount: session.amountPaise,
    currency: 'INR',
    description: session.offerPercent
      ? `${session.planName}: 1 month, ${session.offerPercent}% launch offer`
      : `${session.planName}: 1 month`,
    prefill: { email: session.email },
  });
  if (!paid) return null;
  const { data: summary } = await axios.post('/api/billing/orders/verify', paid, {
    headers: getAuthHeader(),
  });
  return summary as BillingSummary;
}

/**
 * Pay for a plan with Razorpay Checkout. Resolves with the refreshed summary
 * after payment, or null if the user closed Checkout.
 */
export function purchase(planId: string, mode: BillingMode): Promise<BillingSummary | null> {
  return mode === 'subscription' ? subscribe(planId) : buyMonth(planId);
}

export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return `₹${Number.isInteger(rupees) ? rupees : rupees.toFixed(2)}`;
}
