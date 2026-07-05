import React from 'react';
import MarketingPageShell, { useMarketing } from '../components/MarketingPageShell';
import type { UserRecord } from '../types/domain';

interface LandingPageProps {
  onLoggedIn: (user: UserRecord) => void;
  candidateError?: string | null;
}

interface FeatureItem {
  icon: string;
  title: string;
  body: string;
}

const FEATURES: FeatureItem[] = [
  {
    icon: '◇',
    title: 'Real infrastructure',
    body: 'Candidates debug live Docker stacks — Postgres, Kafka, Nginx, and more — not toy puzzles in a browser.',
  },
  {
    icon: '▲',
    title: 'Live metrics',
    body: 'Latency, throughput, and recovery signals stream in real time so interviewers see impact as fixes land.',
  },
  {
    icon: '◆',
    title: 'Incident briefs',
    body: 'Each challenge opens with a production-style situation brief so candidates work like they would on call.',
  },
  {
    icon: '◎',
    title: 'Author & invite',
    body: 'Interviewers build verified challenges, promote sandboxes, and send one-time candidate links — no account needed.',
  },
];

function LandingContent(): JSX.Element {
  const { openLogin, openSales } = useMarketing();

  return (
    <>
      <section className="landing-hero">
        <p className="landing-eyebrow">Technical interviews, on real systems</p>
        <h1>
          Broken infrastructure.
          <br />
          <span className="landing-hero-accent">Live sandboxes.</span>
        </h1>
        <p className="landing-lead">
          Author production incidents with our agent at your side—then run candidates through
          curated labs, agent-built and developer-reviewed, in live Docker sandboxes.
        </p>
        <div className="landing-cta">
          <div className="landing-cta-row">
            <button type="button" onClick={openLogin}>
              Sign in to Devlabs
            </button>
            <button type="button" className="secondary" onClick={openSales}>
              Contact sales
            </button>
          </div>
          <span className="landing-cta-note">
            New company? Contact sales to register.
            Candidates join via invite link — no sign-up required.
          </span>
        </div>
      </section>

      <section className="landing-features">
        <h2>Built for on-call realism</h2>
        <div className="landing-feature-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="landing-feature-card">
              <span className="landing-feature-icon" aria-hidden>{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

export default function LandingPage(props: LandingPageProps): JSX.Element {
  return (
    <MarketingPageShell {...props}>
      <LandingContent />
    </MarketingPageShell>
  );
}
