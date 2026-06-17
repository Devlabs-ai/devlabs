import React from 'react';
import MarketingPageShell, { useMarketing } from '../components/MarketingPageShell';
import PricingCards from '../components/PricingCards';
import { PRICING_PLANS } from '../data/pricingPlans';
import type { UserRecord, PricingPlan } from '../types/domain';

interface PricingPageProps {
  onLoggedIn: (user: UserRecord) => void;
  candidateError?: string | null;
}

function PricingContent(): JSX.Element {
  const { openSales } = useMarketing();

  const handleSelectPlan = (_plan: PricingPlan): void => {
    openSales();
  };

  return (
    <>
      <section className="pricing-hero">
        <p className="landing-eyebrow">Pricing</p>
        <h1>Plans for every hiring team</h1>
        <p className="landing-lead">
          All plans include live Docker sandboxes, real-time metrics, and candidate invite links.
          Companies are onboarded after a quick sales call — no self-serve checkout yet.
        </p>
      </section>

      <section className="pricing-section">
        <PricingCards onSelectPlan={handleSelectPlan} />
      </section>

      <section className="pricing-compare">
        <h2>Compare plans</h2>
        <div className="pricing-table-wrap">
          <table className="pricing-table">
            <thead>
              <tr>
                <th scope="col">Feature</th>
                {PRICING_PLANS.map((plan) => (
                  <th key={plan.id} scope="col">{plan.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['Interviewer seats', '5', '25', 'Unlimited'],
                ['Candidate sessions', '20 / mo', 'Unlimited', 'Unlimited'],
                ['Private library', '—', '✓', '✓'],
                ['Agent authoring', '—', '✓', '✓'],
                ['Dedicated support', '—', 'Email', 'Custom SLA'],
              ].map(([feature, ...values]) => (
                <tr key={feature}>
                  <th scope="row">{feature}</th>
                  {values.map((value, i) => (
                    <td key={PRICING_PLANS[i].id}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function PricingPage(props: PricingPageProps): JSX.Element {
  return (
    <MarketingPageShell {...props}>
      <PricingContent />
    </MarketingPageShell>
  );
}
