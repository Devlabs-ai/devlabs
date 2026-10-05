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
} from '../services/billingApi';

function useRemainingMs(until: Date): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return Math.max(0, until.getTime() - now);
}

function OfferCountdown({ ms }: { ms: number }): JSX.Element {
  const s = Math.floor(ms / 1000);
  const parts: Array<[number, string]> = [
    [Math.floor(s / 86400), 'days'],
    [Math.floor((s % 86400) / 3600), 'hrs'],
    [Math.floor((s % 3600) / 60), 'min'],
    [s % 60, 'sec'],
  ];
  return (
    <div className="pricing-offer-timer" role="timer" aria-live="off">
      {parts.map(([value, unit]) => (
        <span key={unit} className="pricing-offer-timer-cell">
          <strong>{String(value).padStart(2, '0')}</strong>
          <em>{unit}</em>
        </span>
      ))}
    </div>
  );
}

export default function PricingSection(): JSX.Element {
  const navigate = useNavigate();
  const { currentUser, onRequestLogin } = useAppState();
  const reveal = useInView<HTMLElement>();
  const remainingMs = useRemainingMs(LAUNCH_OFFER.endsAt);
  const offerLive = remainingMs > 0;

  const [billingOpen, setBillingOpen] = useState(false);
  const [mode, setMode] = useState<BillingMode>('one_time');
  const oneTime = mode === 'one_time';
  const [entitlements, setEntitlements] = useState<string[]>([]);
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
      return;
    }
    let cancelled = false;
    fetchBillingSummary()
      .then((s) => {
        if (!cancelled) setEntitlements(s.entitlements);
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
        const summary = await purchase(planId, mode);
        if (summary) {
          setEntitlements(summary.entitlements);
          setNotice({
            planId,
            kind: 'ok',
            text: mode === 'one_time' ? `${planName} is unlocked for a month.` : `You're subscribed to ${planName}.`,
          });
        }
      } catch (e) {
        setNotice({ planId, kind: 'error', text: apiErrorMessage(e, 'Could not start checkout') });
      } finally {
        setBusyPlan(null);
      }
    },
    [currentUser, onRequestLogin, mode],
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
              {billingOpen
                ? `${oneTime ? 'Buy' : 'Subscribe'} by October 31 to get it.`
                : `Ends October 31. Payments open ${LAUNCH_OFFER.paymentsOpenLabel}.`}
            </p>
          </div>
          <OfferCountdown ms={remainingMs} />
        </div>
      )}
      <div className="pricing-plans-grid">
        {PRICING_PLANS.map((plan) => {
          const owned = entitlements.includes(plan.id);
          const busy = busyPlan === plan.id;
          const planNotice = notice?.planId === plan.id ? notice : null;
          return (
            <div
              key={plan.id}
              className={`landing-pricing-plan pricing-plan${plan.featured ? ' pricing-plan--featured' : ''}`}
            >
              <p className={`landing-pricing-plan-badge${plan.featured ? '' : ' landing-pricing-plan-badge--muted'}`}>
                {plan.featured ? 'Whole track' : 'Subtrack'}
              </p>
              <h3 className="landing-pricing-plan-name">{plan.name}</h3>
              <p className="landing-pricing-plan-price">
                {offerLive && <s className="pricing-plan-was">₹{plan.price}</s>}
                <span className="landing-pricing-plan-amount">
                  ₹{offerLive ? offerPrice(plan.price) : plan.price}
                </span>
                <span className="landing-pricing-plan-period">
                  {offerLive ? '/ first month' : '/ month'}
                </span>
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
                  {owned ? (
                    <Link to="/profile" className="landing-cta-primary pricing-plan-owned">
                      {oneTime ? 'Active · Extend' : 'Subscribed · Manage'}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="landing-cta-primary"
                      disabled={busy || busyPlan !== null}
                      onClick={() => void onSubscribe(plan.id, plan.name)}
                    >
                      {busy
                        ? 'Opening checkout…'
                        : oneTime
                          ? `Get 1 month of ${plan.name}`
                          : `Subscribe to ${plan.name}`}
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
