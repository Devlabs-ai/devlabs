import React from 'react';
import MarketingPageShell from '../components/MarketingPageShell';
import type { UserRecord } from '../types/domain';

interface AboutPageProps {
  onLoggedIn: (user: UserRecord) => void;
  candidateError?: string | null;
}

function AboutContent(): JSX.Element {
  return (
    <>
      <section className="about-hero">
        <p className="landing-eyebrow">About</p>
        <h1>Built by engineers, for engineers</h1>
        <p className="landing-lead">
          Devlabs is a technical interview platform for infrastructure debugging —
          live Docker sandboxes, production-style incidents, and the kind of work
          that actually predicts performance on the job.
        </p>
      </section>

      <section className="about-story">
        <div className="about-story-block">
          <h2>Who are we</h2>
          <p>
            Engineers behind Devlabs have sat in the same rooms — as candidates,
            interviewers, and on call. The gap between what most hiring loops test
            and what the job requires is familiar: trivia on one side, outages and
            misconfigured services on the other.
          </p>
          <p>
            In a world of fast-moving agents, that gap matters more. Traditional
            interviews still reward recall and rehearsed answers — skills agents can
            surface in seconds. What they cannot replace is the critical thinking
            candidates need in practice: reading ambiguous signals, narrowing a blast
            radius under pressure, and deciding what to fix first when a system is
            still on fire.
          </p>
          <p>
            That experience is what Devlabs is built from. Engineers who run panels
            want signal from real debugging. Engineers being interviewed want a fair
            shot to show how they actually work. Devlabs connects those two sides
            with live environments, incident briefs, and metrics that move when a fix
            lands.
          </p>
        </div>
      </section>
    </>
  );
}

export default function AboutPage(props: AboutPageProps): JSX.Element {
  return (
    <MarketingPageShell {...props}>
      <AboutContent />
    </MarketingPageShell>
  );
}
