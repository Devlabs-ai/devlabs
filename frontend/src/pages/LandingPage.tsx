import React, { useEffect, useRef, useState } from 'react';
import MarketingPageShell, { useMarketing } from '../components/MarketingPageShell';
import type { UserRecord } from '../types/domain';

interface LandingPageProps {
  onLoggedIn: (user: UserRecord) => void;
}

/** Adds .is-inview when scrolled into view (for staggered slide-in). */
function useInView<T extends HTMLElement>(rootMargin = '0px 0px -12% 0px'): {
  ref: React.RefObject<T | null>;
  inView: boolean;
} {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { root: null, rootMargin, threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}

function HeroPanel(): JSX.Element {
  return (
    <div className="landing-panel" aria-hidden>
      <div className="landing-panel-glow" />
      <div className="landing-hero-panel">
        <div className="landing-hero-panel-bar">
          <span />
          <span />
          <span />
          <em>lab · spark-skew-v2</em>
        </div>
        <pre className="landing-hero-panel-code">{`# validate against live cluster
spark-submit --master k8s://... \\
  --conf spark.executor.memory=4g \\
  jobs/fix_skew.py

✓ partitions rebalanced
✓ shuffle spill ↓ 82%
✓ checks passed — 14/14`}</pre>
      </div>
    </div>
  );
}

function LandingContent(): JSX.Element {
  const { openLogin, openSales } = useMarketing();
  const intentReveal = useInView<HTMLElement>();
  const ch1Reveal = useInView<HTMLElement>();
  const ch2Reveal = useInView<HTMLElement>();

  return (
    <>
      <section className="landing-screen">
        <div className="landing-screen-copy">
          <p className="landing-brand-mark">
            DevLabs <span>v0.2</span>
          </p>
          <h1>Hands-on learning for modern engineering</h1>
          <p className="landing-lead">
            Master production-grade systems in isolated labs — build pipelines,
            troubleshoot failures, and validate against automated checks.
          </p>
          <div className="landing-cta">
            <div className="landing-cta-row">
              <button type="button" onClick={openLogin}>
                Start learning
              </button>
              <button type="button" className="secondary" onClick={openSales}>
                Contact sales
              </button>
            </div>
            <span className="landing-cta-note">
              Sign in with any email to open Play.
            </span>
          </div>
        </div>
        <HeroPanel />
      </section>

      <section className="landing-chapters" aria-label="Platform">
        <article
          ref={intentReveal.ref}
          className={`landing-intent landing-intent--split${intentReveal.inView ? ' is-inview' : ''}`}
        >
          <div className="landing-intent-copy landing-reveal landing-reveal--1">
            <p className="landing-kicker">Why DevLabs</p>
            <h2>Because reading about systems is not the same as running them</h2>
            <p>
              Distributed systems are learned by failing against them — debugging skew,
              lag, missed SLAs, and broken schemas under real constraints. DevLabs puts
              that work in isolated sandboxes with automated proof, so engineers build
              depth the way production actually demands it.
            </p>
            <p className="landing-intent-ai">
              Agents already operate in parallel and excel at narrow tasks. The goal
              is not to rely on them blindly, but to grow judgment and resilience —
              and still handle what remains uniquely human.
            </p>
          </div>

          <aside
            className="landing-intent-side landing-reveal landing-reveal--2"
            aria-label="For upcoming engineers"
          >
            <p className="landing-kicker">For upcoming engineers</p>
            <h3>Courage to Approve agent changes — earned, not guessed</h3>
            <p>
              With coding agents like Claude, Cursor, and Copilot, fast-moving
              teams often train only one habit: click Accept or Approve and ship.
            </p>
            <p>
              DevLabs builds the systems skill underneath — so when an agent
              proposes a change, you understand the blast radius and approve
              with confidence.
            </p>
            <div className="landing-approve" aria-hidden>
              <div className="landing-approve-dialog">
                <div className="landing-approve-dialog-head">
                  <span className="landing-approve-badge">Cursor</span>
                  <em>Agent edit · spark_job.py</em>
                </div>
                <p className="landing-approve-diff">
                  <span className="landing-approve-diff-add">+ executor.memory = &quot;4g&quot;</span>
                  <span className="landing-approve-diff-add">+ shuffle.partitions = 200</span>
                </p>
                <p className="landing-approve-prompt">
                  Apply this agent suggestion?
                </p>
                <div className="landing-approve-actions">
                  <span className="landing-approve-ghost">Reject</span>
                  <span className="landing-approve-btn">
                    <span className="landing-approve-btn-fill" />
                    <span className="landing-approve-btn-label landing-approve-btn-label--idle">
                      Accept
                    </span>
                    <span className="landing-approve-btn-label landing-approve-btn-label--done">
                      Accepted
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </article>

        <article
          ref={ch1Reveal.ref}
          className={`landing-chapter landing-reveal landing-reveal--1${ch1Reveal.inView ? ' is-inview' : ''}`}
        >
          <div className="landing-chapter-index" aria-hidden>01</div>
          <div className="landing-chapter-body">
            <h2>Shared clusters. Private sandboxes.</h2>
            <p>
              Spark, Kafka, Airflow, and storage run as shared infrastructure —
              sliced per learner with namespaces, quotas, topics, and buckets.
              It feels like your own production stack, without a cluster per person.
            </p>
            <ul className="landing-chapter-points">
              <li>Shared compute &amp; messaging</li>
              <li>Isolated workspace &amp; datasets</li>
              <li>Personal quotas &amp; dashboards</li>
            </ul>
          </div>
        </article>

        <article
          ref={ch2Reveal.ref}
          className={`landing-chapter landing-reveal landing-reveal--1${ch2Reveal.inView ? ' is-inview' : ''}`}
        >
          <div className="landing-chapter-index" aria-hidden>02</div>
          <div className="landing-chapter-body">
            <h2>Grade as you go. Scale without waste.</h2>
            <p>
              Automated checks give immediate feedback with metrics and explanations.
              Workloads queue fairly on shared capacity; idle resources are reclaimed
              so thousands can learn at sustainable cost.
            </p>
            <ul className="landing-chapter-points">
              <li>Continuous evaluation</li>
              <li>Fair scheduling &amp; limits</li>
              <li>Reclaim idle capacity</li>
            </ul>
          </div>
        </article>
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
