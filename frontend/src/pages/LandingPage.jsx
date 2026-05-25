import React, { useEffect, useState } from 'react';
import LoginModal from '../components/LoginModal.jsx';

const FEATURES = [
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

const STEPS = [
  { n: '01', title: 'Author a challenge', body: 'Define broken services, validation rules, and an incident narrative in the authoring workspace.' },
  { n: '02', title: 'Invite a candidate', body: 'Share a one-time link. They land straight in the assigned sandbox with terminal and metrics ready.' },
  { n: '03', title: 'Debug live', body: 'Candidates shell into containers, trace the failure, and prove recovery when metrics cross the threshold.' },
];

export default function LandingPage({ onLoggedIn, candidateError }) {
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    if (candidateError) setLoginOpen(true);
  }, [candidateError]);

  const inviteError = candidateError ? `Candidate invite error: ${candidateError}` : null;

  return (
    <div className={`landing ${loginOpen ? 'landing-modal-open' : ''}`}>
      <header className="landing-header">
        <div className="landing-brand">
          <span className="logo-dot" />
          Devlabs
        </div>
      </header>

      <main className="landing-main">
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
            <button type="button" onClick={() => setLoginOpen(true)}>
              Get started as interviewer
            </button>
            <span className="landing-cta-note">
              Candidates join via invite link — no sign-up required
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

        <section className="landing-steps">
          <h2>How it works</h2>
          <ol className="landing-step-list">
            {STEPS.map((s) => (
              <li key={s.n} className="landing-step">
                <span className="landing-step-n">{s.n}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-footer-cta">
          <div className="landing-footer-card">
            <h2>Ready to run your next interview?</h2>
            <p>Sign in to open the challenge library, authoring tools, and catalogue memories.</p>
            <button type="button" onClick={() => setLoginOpen(true)}>
              Sign in to Devlabs
            </button>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <span>Devlabs v0.1</span>
        <span className="landing-footer-sep">·</span>
        <span>Interview platform for infrastructure debugging</span>
      </footer>

      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onLoggedIn={onLoggedIn}
        initialError={inviteError}
      />
    </div>
  );
}
