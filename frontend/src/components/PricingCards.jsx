import React from 'react';
import { PRICING_PLANS } from '../data/pricingPlans.js';

export default function PricingCards({ onSelectPlan, compact = false }) {
  return (
    <div className={`pricing-grid ${compact ? 'pricing-grid-compact' : ''}`}>
      {PRICING_PLANS.map((plan) => (
        <article
          key={plan.id}
          className={`pricing-card ${plan.highlighted ? 'pricing-card-highlighted' : ''}`}
        >
          {plan.highlighted && <span className="pricing-badge">Most popular</span>}
          <header className="pricing-card-head">
            <h3>{plan.name}</h3>
            <div className="pricing-price">
              <span className="pricing-price-amount">{plan.price}</span>
              {plan.period && <span className="pricing-price-period">{plan.period}</span>}
            </div>
            <p>{plan.description}</p>
          </header>

          {!compact && (
            <ul className="pricing-features">
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className={plan.highlighted ? 'login-submit pricing-cta' : 'secondary pricing-cta'}
            onClick={() => onSelectPlan(plan)}
          >
            {plan.cta}
          </button>
        </article>
      ))}
    </div>
  );
}
