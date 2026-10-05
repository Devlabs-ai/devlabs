import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PRICING_PATH } from '../constants/pricing';
import {
  apiErrorMessage,
  cancelSubscription,
  fetchBillingSummary,
  formatPaise,
  purchase,
  type BillingSubscription,
  type BillingSummary,
} from '../services/billingApi';

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function describe(sub: BillingSubscription): string {
  if (sub.kind === 'one_time') {
    return sub.entitled
      ? `Access until ${formatDate(sub.paidUntil)}. Doesn’t renew automatically.`
      : `Ended ${formatDate(sub.paidUntil)}.`;
  }
  if (sub.status === 'pending') {
    return 'Your last renewal payment failed. Razorpay is retrying; update your payment method from the Razorpay email to keep access.';
  }
  if (sub.cancelRequested || sub.status === 'cancelled' || sub.status === 'completed') {
    return sub.entitled ? `Cancelled. Access until ${formatDate(sub.paidUntil)}.` : 'Ended.';
  }
  if (sub.status === 'halted') return 'Paused after repeated failed payments.';
  if (sub.nextChargeAt) {
    return `Renews on ${formatDate(sub.nextChargeAt)} for ${formatPaise(sub.monthlyAmountPaise)}.`;
  }
  return sub.entitled ? `Access until ${formatDate(sub.paidUntil)}.` : sub.status;
}

function canCancel(sub: BillingSubscription): boolean {
  return (
    sub.kind === 'subscription' &&
    !sub.cancelRequested &&
    ['authenticated', 'active', 'pending'].includes(sub.status)
  );
}

/** One card per plan for one-month passes: the pass that runs latest represents the plan. */
function collapsePasses(subs: BillingSubscription[]): BillingSubscription[] {
  const latestPass = new Map<string, BillingSubscription>();
  const out: BillingSubscription[] = [];
  for (const s of subs) {
    if (s.kind !== 'one_time') {
      out.push(s);
      continue;
    }
    const prev = latestPass.get(s.planId);
    if (!prev || (s.paidUntil || 0) > (prev.paidUntil || 0)) latestPass.set(s.planId, s);
  }
  return [...out, ...latestPass.values()];
}

export default function SubscriptionsPanel(): JSX.Element {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [extending, setExtending] = useState<string | null>(null);

  const onExtend = async (sub: BillingSubscription): Promise<void> => {
    setExtending(sub.planId);
    setError(null);
    try {
      const next = await purchase(sub.planId, 'one_time');
      if (next) setSummary(next);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not start checkout'));
    } finally {
      setExtending(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchBillingSummary()
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorMessage(e, 'Could not load subscriptions'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onCancel = async (sub: BillingSubscription): Promise<void> => {
    const until = sub.paidUntil ? ` You keep access until ${formatDate(sub.paidUntil)}.` : '';
    if (!window.confirm(`Cancel your ${sub.planName} subscription?${until}`)) return;
    setCancelling(sub.id);
    setError(null);
    try {
      setSummary(await cancelSubscription(sub.id));
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not cancel the subscription'));
    } finally {
      setCancelling(null);
    }
  };

  const cards = collapsePasses(summary?.subscriptions || []);
  const current = cards.filter((s) => s.entitled || canCancel(s));
  const past = cards.filter((s) => !current.includes(s));
  const payments = summary?.payments || [];

  return (
    <section className="profile-panel" aria-labelledby="profile-subs-heading">
      <h2 id="profile-subs-heading" className="profile-panel-title">
        Subscriptions
      </h2>

      {error && (
        <p className="profile-billing-error" role="alert">
          {error}
        </p>
      )}

      {!summary && !error ? <p className="profile-panel-copy">Loading…</p> : null}

      {summary && current.length === 0 ? (
        <div className="profile-plan-card">
          <p className="profile-plan-badge">Current plan</p>
          <h3 className="profile-plan-name">Beta access</h3>
          <p className="profile-plan-price">Free</p>
          <p className="profile-panel-copy">
            {summary.enabled
              ? 'You don’t have a paid track yet. Pick one on the pricing page.'
              : 'You’re on open beta: the full practice floor while we grow. Paid plans will appear here when billing opens.'}
          </p>
          <Link to={PRICING_PATH} className="profile-panel-link">
            View pricing
          </Link>
        </div>
      ) : null}

      {current.map((sub) => (
        <div key={sub.id} className="profile-plan-card profile-billing-sub">
          <p className="profile-plan-badge">{sub.entitled ? 'Active' : 'Inactive'}</p>
          <h3 className="profile-plan-name">{sub.planName}</h3>
          <p className="profile-plan-price">
            {formatPaise(sub.monthlyAmountPaise)}
            <span className="profile-billing-period"> / month</span>
          </p>
          <p className="profile-panel-copy">{describe(sub)}</p>
          {sub.kind === 'one_time' && summary?.enabled && summary.mode === 'one_time' && (
            <button
              type="button"
              className="profile-billing-extend"
              disabled={extending !== null}
              onClick={() => void onExtend(sub)}
            >
              {extending === sub.planId ? 'Opening checkout…' : 'Add another month'}
            </button>
          )}
          {canCancel(sub) && (
            <button
              type="button"
              className="profile-billing-cancel"
              disabled={cancelling === sub.id}
              onClick={() => void onCancel(sub)}
            >
              {cancelling === sub.id ? 'Cancelling…' : 'Cancel subscription'}
            </button>
          )}
        </div>
      ))}

      {past.length > 0 && (
        <p className="profile-panel-copy profile-billing-past">
          Past: {past.map((s) => `${s.planName} (${formatDate(s.createdAt)})`).join(', ')}
        </p>
      )}

      {payments.length > 0 && (
        <div className="profile-billing-payments">
          <h3 className="profile-billing-subtitle">Payment history</h3>
          <table className="profile-billing-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Plan</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.createdAt)}</td>
                  <td>{summary?.subscriptions.find((s) => s.planId === p.planId)?.planName || p.planId || '—'}</td>
                  <td>{formatPaise(p.amountPaise)}</td>
                  <td>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
