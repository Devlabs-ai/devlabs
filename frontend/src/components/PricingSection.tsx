import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useInView } from '../hooks/useInView';
import { useAppState } from '../context/AppStateContext';
import { LAUNCH_OFFER, PRICING_PATH, PRICING_PLANS, offerPrice } from '../constants/pricing';
import {
  apiErrorMessage,
  fetchBillingConfig,
  fetchBillingSummary,
  purchase,
  type BillingMode,
  type BillingSummary,
} from '../services/billingApi';

/** Latest paid-until per plan the user bought directly (not via a bundle). */
function accessUntilByPlan(summary: BillingSummary): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of summary.subscriptions) {
    if (!s.entitled || !s.paidUntil) continue;
    out[s.planId] = Math.max(out[s.planId] || 0, s.paidUntil);
  }
  return out;
}

function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function useRemainingMs(until: Date): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return Math.max(0, until.getTime() - now);
}

export default function PricingSection(): JSX.Element {
  const navigate = useNavigate();
  const { currentUser, onRequestLogin, refreshChallenges } = useAppState();
  const reveal = useInView<HTMLElement>();
  const remainingMs = useRemainingMs(LAUNCH_OFFER.endsAt);
  const offerLive = remainingMs > 0;

  const [billingOpen, setBillingOpen] = useState(false);
  const [mode, setMode] = useState<BillingMode>('one_time');
  const oneTime = mode === 'one_time';
  const [entitlements, setEntitlements] = useState<string[]>([]);
  const [accessUntil, setAccessUntil] = useState<Record<string, number>>({});
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ planId: string; kind: 'ok' | 'error'; text: string } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetchBillingConfig()
      .then((cfg) => {
        if (cancelled) return;
        setBillingOpen(cfg.enabled);
        setMode(cfg.mode);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!billingOpen || !currentUser) {
      setEntitlements([]);
      setAccessUntil({});
      return;
    }
    let cancelled = false;
    fetchBillingSummary()
      .then((s) => {
        if (cancelled) return;
        setEntitlements(s.entitlements);
        setAccessUntil(accessUntilByPlan(s));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [billingOpen, currentUser]);

  const onSubscribe = useCallback(
    async (planId: string, planName: string) => {
      if (!currentUser) {
        onRequestLogin(PRICING_PATH);
        return;
      }
      setBusyPlan(planId);
      setNotice(null);
      try {
        const extending = entitlements.includes(planId);
        const summary = await purchase(planId, mode);
        if (summary) {
          setEntitlements(summary.entitlements);
          setAccessUntil(accessUntilByPlan(summary));
          void refreshChallenges();
          setNotice({
            planId,
            kind: 'ok',
            text: extending
              ? `Added another month of ${planName}.`
              : mode === 'one_time'
                ? `${planName} is unlocked for a month.`
                : `You're subscribed to ${planName}.`,
          });
        }
      } catch (e) {
        setNotice({ planId, kind: 'error', text: apiErrorMessage(e, 'Could not start checkout') });
      } finally {
        setBusyPlan(null);
      }
    },
    [currentUser, onRequestLogin, refreshChallenges, mode, entitlements],
  );

  return (
    <section
      id="pricing"
      ref={reveal.ref}
      className={`pricing-plans${reveal.inView ? ' is-inview' : ''}`}
      aria-label="Pricing"
    >
      <h2 className="landing-section-title pricing-plans-title">Pricing</h2>
      {offerLive && (
        <div className="pricing-offer">
          <div className="pricing-offer-copy">
            <p className="pricing-offer-title">
              Launch offer: <span>{LAUNCH_OFFER.percentOff}% off</span> your first month on every track
            </p>
            <p className="pricing-offer-note">
              We open in the first week of November. For more details,{' '}
              <Link to="/#waitlist">join the waitlist</Link>.
            </p>
          </div>
        </div>
      )}
      <div className="pricing-plans-grid">
        {PRICING_PLANS.map((plan) => {
          const owned = entitlements.includes(plan.id);
          const ownedUntil = accessUntil[plan.id] || null;
          const viaBundle = owned && !ownedUntil;
          const busy = busyPlan === plan.id;
          const planNotice = notice?.planId === plan.id ? notice : null;
          return (
            <div
              key={plan.id}
              className={`landing-pricing-plan pricing-plan${plan.featured ? ' pricing-plan--featured' : ''}${owned ? ' pricing-plan--owned' : ''}`}
            >
              {owned && (
                <p className="landing-pricing-plan-badge pricing-plan-badge--active">
                  <span className="pricing-plan-active-dot" aria-hidden />
                  Active
                </p>
              )}
              <h3 className="landing-pricing-plan-name">{plan.name}</h3>
              <p className="landing-pricing-plan-price">
                {offerLive && <s className="pricing-plan-was">₹{plan.price}</s>}
                <span className="landing-pricing-plan-amount">
                  ₹{offerLive ? offerPrice(plan.price) : plan.price}
                </span>
                <span className="landing-pricing-plan-period">/ month</span>
              </p>
              {offerLive && (
                <p className="pricing-plan-then">
                  then ₹{plan.price} / {billingOpen && oneTime ? 'extra month' : 'month'}
                </p>
              )}
              <ul className="landing-pricing-plan-includes">
                {plan.checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {billingOpen ? (
                <>
                  {owned && (
                    <p className="pricing-plan-access">
                      {viaBundle
                        ? 'Included in your DevOps Engineer plan'
                        : `${oneTime ? 'Unlocked' : 'Subscribed'} until ${formatDay(ownedUntil as number)}`}
                    </p>
                  )}
                  {viaBundle ? null : owned ? (
                    oneTime ? (
                      <button
                        type="button"
                        className="landing-cta-primary pricing-plan-owned"
                        disabled={busy || busyPlan !== null}
                        onClick={() => void onSubscribe(plan.id, plan.name)}
                      >
                        {busy ? 'Opening checkout…' : 'Add another month'}
                      </button>
                    ) : (
                      <Link to="/profile" className="landing-cta-primary pricing-plan-owned">
                        Manage subscription
                      </Link>
                    )
                  ) : (
                    <button
                      type="button"
                      className="landing-cta-primary"
                      disabled={busy || busyPlan !== null}
                      aria-label={busy ? undefined : `${oneTime ? 'Purchase' : 'Subscribe to'} ${plan.name}`}
                      onClick={() => void onSubscribe(plan.id, plan.name)}
                    >
                      {busy ? 'Opening checkout…' : oneTime ? 'Purchase' : 'Subscribe'}
                      {!busy && (
                        <span className="landing-cta-arrow" aria-hidden>
                          →
                        </span>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    className="pricing-plan-explore"
                    onClick={() => navigate(plan.path)}
                  >
                    Explore {plan.name}
                  </button>
                  {planNotice && (
                    <p
                      className={`pricing-plan-notice pricing-plan-notice--${planNotice.kind}`}
                      role={planNotice.kind === 'error' ? 'alert' : 'status'}
                    >
                      {planNotice.text}
                    </p>
                  )}
                </>
              ) : (
                <button type="button" className="landing-cta-primary" onClick={() => navigate(plan.path)}>
                  Explore {plan.name}
                  <span className="landing-cta-arrow" aria-hidden>
                    →
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
