import React, { useEffect, useRef, useState } from 'react';
import MarketingPageShell, { useMarketing } from '../components/MarketingPageShell';
import {
  ProjectsAnim,
  TracksAnim,
  WhiteboardAnim,
} from '../components/LandingFeatureAnims';
import type { UserRecord } from '../types/domain';

interface LandingPageProps {
  onLoggedIn: (user: UserRecord) => void;
}

/** Adds .is-inview when scrolled into view (for staggered slide-in). */
function useInView<T extends HTMLElement>(rootMargin = '0px 0px -12% 0px'): {
  ref: React.RefObject<T>;
  inView: boolean;
} {
  const ref = useRef<T>(null as unknown as T);
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

type HeroLabLine =
  | { kind: 'comment'; text: string }
  | { kind: 'cmd'; text: string }
  | { kind: 'flag'; text: string }
  | { kind: 'blank' }
  | { kind: 'ok'; text: string };

const HERO_LABS: ReadonlyArray<{
  id: string;
  title: string;
  accent: string;
  lines: ReadonlyArray<HeroLabLine>;
}> = [
  {
    id: 'spark',
    title: 'lab · spark-skew-v2',
    accent: '#38bdf8',
    lines: [
      { kind: 'comment', text: '# validate against live cluster' },
      { kind: 'cmd', text: 'spark-submit --master k8s://... \\' },
      { kind: 'flag', text: '  --conf spark.executor.memory=4g \\' },
      { kind: 'flag', text: '  jobs/fix_skew.py' },
      { kind: 'blank' },
      { kind: 'ok', text: 'partitions rebalanced' },
      { kind: 'ok', text: 'shuffle spill ↓ 82%' },
      { kind: 'ok', text: 'checks passed — 14/14' },
    ],
  },
  {
    id: 'k8s',
    title: 'lab · k8s-rollout-safe',
    accent: '#a78bfa',
    lines: [
      { kind: 'comment', text: '# stage canary, then promote' },
      { kind: 'cmd', text: 'kubectl apply -f canary.yaml' },
      { kind: 'cmd', text: 'kubectl rollout status deploy/orders' },
      { kind: 'blank' },
      { kind: 'ok', text: '2/2 pods Ready' },
      { kind: 'ok', text: 'error rate < 0.1%' },
      { kind: 'ok', text: 'promote → stable' },
    ],
  },
  {
    id: 'distributed',
    title: 'lab · kafka-rebalance',
    accent: '#fbbf24',
    lines: [
      { kind: 'comment', text: '# watch consumer group lag' },
      { kind: 'cmd', text: 'kafka-consumer-groups \\' },
      { kind: 'flag', text: '  --describe --group payments' },
      { kind: 'blank' },
      { kind: 'ok', text: 'partitions reassigned' },
      { kind: 'ok', text: 'lag ↓ 94% in 12s' },
      { kind: 'ok', text: 'no under-replicated' },
    ],
  },
];

function renderLabLine(line: HeroLabLine, key: number, partialText?: string): React.ReactNode {
  if (line.kind === 'blank') {
    return <span key={key} className="landing-term-blank">{'\n'}</span>;
  }
  const text = partialText ?? ('text' in line ? line.text : '');
  if (line.kind === 'ok') {
    return (
      <span key={key} className="landing-term-ok">
        <span className="landing-term-check">✓</span> {text}
        {partialText === undefined ? '\n' : null}
      </span>
    );
  }
  return (
    <span key={key} className={`landing-term-${line.kind}`}>
      {text}
      {partialText === undefined ? '\n' : null}
    </span>
  );
}

function HeroPanel(): JSX.Element {
  const [index, setIndex] = useState(0);
  const [lineIdx, setLineIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [done, setDone] = useState(false);
  const reduceMotion = useRef(false);

  const lab = HERO_LABS[index] ?? HERO_LABS[0];

  useEffect(() => {
    reduceMotion.current =
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }, []);

  // Reset typing when lab changes
  useEffect(() => {
    setLineIdx(0);
    setCharIdx(0);
    setDone(false);
  }, [index]);

  // Typewriter + cycle
  useEffect(() => {
    if (reduceMotion.current) {
      setLineIdx(lab.lines.length);
      setCharIdx(0);
      setDone(true);
      const hold = window.setTimeout(() => {
        setIndex((i) => (i + 1) % HERO_LABS.length);
      }, 3200);
      return () => window.clearTimeout(hold);
    }

    if (done) {
      const hold = window.setTimeout(() => {
        setIndex((i) => (i + 1) % HERO_LABS.length);
      }, 2200);
      return () => window.clearTimeout(hold);
    }

    if (lineIdx >= lab.lines.length) {
      setDone(true);
      return undefined;
    }

    const line = lab.lines[lineIdx];
    if (!line) {
      setDone(true);
      return undefined;
    }

    if (line.kind === 'blank') {
      const t = window.setTimeout(() => {
        setLineIdx((n) => n + 1);
        setCharIdx(0);
      }, 180);
      return () => window.clearTimeout(t);
    }

    if (line.kind === 'ok') {
      const t = window.setTimeout(() => {
        setLineIdx((n) => n + 1);
        setCharIdx(0);
      }, 420);
      return () => window.clearTimeout(t);
    }

    if (charIdx < line.text.length) {
      const delay = line.kind === 'comment' ? 18 : 28;
      const t = window.setTimeout(() => {
        setCharIdx((c) => c + 1);
      }, delay);
      return () => window.clearTimeout(t);
    }

    const t = window.setTimeout(() => {
      setLineIdx((n) => n + 1);
      setCharIdx(0);
    }, 120);
    return () => window.clearTimeout(t);
  }, [index, lineIdx, charIdx, done, lab.lines]);

  const completed = lab.lines.slice(0, lineIdx);
  const current = !done && lineIdx < lab.lines.length ? lab.lines[lineIdx] : null;
  const typingLine =
    current && current.kind !== 'blank' && current.kind !== 'ok' ? current : null;
  const typingDone = Boolean(typingLine && charIdx >= typingLine.text.length);
  const partial =
    typingLine && !typingDone ? typingLine.text.slice(0, charIdx) : undefined;

  return (
    <div className="landing-panel" aria-hidden>
      <div
        className="landing-panel-glow"
        style={{ background: `radial-gradient(ellipse at center, ${lab.accent}33, transparent 68%)` }}
      />
      <div className="landing-hero-panel">
        <div className="landing-hero-panel-bar">
          <span />
          <span />
          <span />
          <em className="landing-hero-panel-label" style={{ color: lab.accent }}>
            {lab.title}
          </em>
        </div>
        <div className="landing-hero-panel-body">
          <pre className="landing-hero-panel-code">
            {completed.map((line, i) => renderLabLine(line, i))}
            {current && (current.kind === 'ok' || current.kind === 'blank')
              ? renderLabLine(current, lineIdx)
              : null}
            {typingLine
              ? renderLabLine(typingLine, lineIdx, typingDone ? undefined : partial)
              : null}
            {!done ? <span className="landing-term-cursor">▋</span> : null}
          </pre>
        </div>
        <div className="landing-hero-panel-dots">
          {HERO_LABS.map((item, i) => (
            <span
              key={item.id}
              className={`landing-hero-panel-dot${i === index ? ' is-active' : ''}`}
              style={i === index ? { background: item.accent } : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function LandingContent(): JSX.Element {
  const { openLogin } = useMarketing();
  const platformReveal = useInView<HTMLElement>();
  const offer1 = useInView<HTMLElement>();
  const offer2 = useInView<HTMLElement>();
  const offer3 = useInView<HTMLElement>();
  const pricingReveal = useInView<HTMLElement>();
  const [pricingSlide, setPricingSlide] = useState(0);

  return (
    <>
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <h1 className="landing-hero-title">
            <span className="landing-hero-line">The bridge</span>
            <span className="landing-hero-line">to become a</span>
            <span className="landing-hero-line landing-hero-line--accent">versatile engineer</span>
          </h1>
          <p className="landing-lead">
            Practice hands-on <strong>Tracks</strong> and <strong>Hand-Crafted Projects</strong> in a
            sandboxed environment — fail safely, get graded instantly.
          </p>
          <div className="landing-cta">
            <button type="button" className="landing-cta-primary" onClick={openLogin}>
              Start learning
              <span className="landing-cta-arrow" aria-hidden>
                →
              </span>
            </button>
          </div>
        </div>
        <HeroPanel />
      </section>

      <section
        ref={platformReveal.ref}
        className={`landing-platform${platformReveal.inView ? ' is-inview' : ''}`}
        aria-label="What DevSetu offers"
      >
        <p className="landing-kicker">The platform</p>
        <h2 className="landing-section-title landing-section-title--punch">
          <span className="landing-hero-line">What DevSetu</span>
          <span className="landing-hero-line landing-hero-line--accent">unlocks</span>
        </h2>
      </section>

      <section className="landing-chapters" aria-label="Platform offerings">
        <article
          id="offer-tracks"
          ref={offer1.ref}
          className={`landing-feature${offer1.inView ? ' is-inview' : ''}`}
        >
          <div className="landing-feature-copy">
            <h3>Guided paths through real systems.</h3>
            <p>
              <strong>Tracks</strong> take you through sequenced labs across Kubernetes, Spark, and
              data platforms — readings paired with challenges you run yourself. Fail safely, get
              graded instantly, and leave knowing what broke and why.
            </p>
          </div>
          <figure className="landing-feature-media" aria-label="Tracks animation">
            <TracksAnim />
          </figure>
        </article>

        <article
          id="offer-projects"
          ref={offer2.ref}
          className={`landing-feature landing-feature--flip${offer2.inView ? ' is-inview' : ''}`}
        >
          <div className="landing-feature-copy">
            <h3>Build the systems you only read about.</h3>
            <p>
              <strong>Projects</strong> are hand-crafted majors that take you from an empty repo to
              a working system — a key-value store, a query engine, a message bus — chapter by
              chapter, with theory on one side and a live scratch workspace on the other.
            </p>
          </div>
          <figure className="landing-feature-media" aria-label="Projects animation">
            <ProjectsAnim />
          </figure>
        </article>

        <article
          id="offer-whiteboard"
          ref={offer3.ref}
          className={`landing-feature${offer3.inView ? ' is-inview' : ''}`}
        >
          <div className="landing-feature-copy">
            <h3>Design the requirement before you chase the detail.</h3>
            <p>
              Not every technical idea fits a neat graded lab. On the <strong>Whiteboard</strong>,
              you sketch the shape of a problem from the statement — blocks, flows, and constraints
              — so you can reason about the design before (or instead of) spinning up a full
              challenge.
            </p>
          </div>
          <figure className="landing-feature-media" aria-label="Whiteboard animation">
            <WhiteboardAnim />
          </figure>
        </article>
      </section>

      <section
        ref={pricingReveal.ref}
        className={`landing-pricing${pricingReveal.inView ? ' is-inview' : ''}`}
        aria-label="Pricing"
      >
        <div className="landing-pricing-intro">
          <p className="landing-kicker">The pricing</p>
          <h2 className="landing-section-title landing-section-title--punch">
            <span className="landing-hero-line">Affordable</span>
            <span className="landing-hero-line landing-hero-line--accent">by design</span>
          </h2>
          <p className="landing-section-lead">
            Running private infra for every learner would price this out of reach. So we run
            DevSetu on optimized shared infrastructure — real labs, without the cost of going it
            alone.
          </p>
          <ul className="landing-pricing-reasons">
            <li>Tracks, Projects, and Whiteboard on one membership</li>
            <li>Instant grading and fair reclaim so capacity stays sustainable</li>
          </ul>
        </div>

        <div className="landing-pricing-carousel">
          <div className="landing-pricing-carousel-viewport">
            <div
              className="landing-pricing-carousel-track"
              style={{ transform: `translateX(-${pricingSlide * 100}%)` }}
            >
              <div className="landing-pricing-plan landing-pricing-plan--beta">
                <p className="landing-pricing-plan-badge">Beta</p>
                <h3 className="landing-pricing-plan-name">Open for beta access</h3>
                <p className="landing-pricing-plan-price">
                  <span className="landing-pricing-plan-amount">Free</span>
                </p>
                <p className="landing-pricing-plan-note">
                  Practice on live shared labs while we grow — Kubernetes and Spark for now.
                </p>
                <ul className="landing-pricing-plan-includes">
                  <li>Kubernetes Track</li>
                  <li>Spark Track</li>
                </ul>
                <button type="button" className="landing-cta-primary" onClick={openLogin}>
                  Start learning
                  <span className="landing-cta-arrow" aria-hidden>
                    →
                  </span>
                </button>
                <p className="landing-pricing-teams">More tracks &amp; projects coming soon.</p>
              </div>

              <div className="landing-pricing-plan landing-pricing-plan--disabled" aria-disabled="true">
                <p className="landing-pricing-plan-badge landing-pricing-plan-badge--muted">
                  Coming soon
                </p>
                <h3 className="landing-pricing-plan-name">Individual</h3>
                <p className="landing-pricing-plan-price">
                  <span className="landing-pricing-plan-amount">₹499</span>
                  <span className="landing-pricing-plan-period">/ month</span>
                </p>
                <p className="landing-pricing-plan-note">
                  Full practice floor while we grow — lock in early access pricing.
                </p>
                <ul className="landing-pricing-plan-includes">
                  <li>All Tracks &amp; readings</li>
                  <li>Hand-crafted Projects</li>
                  <li>Whiteboard for design drills</li>
                </ul>
                <button type="button" className="landing-cta-primary" disabled>
                  Not available yet
                </button>
                <p className="landing-pricing-teams">Teams &amp; campuses — talk to us.</p>
              </div>
            </div>
          </div>

          <div className="landing-pricing-carousel-nav">
            <button
              type="button"
              className="landing-pricing-carousel-btn"
              aria-label="Previous plan"
              disabled={pricingSlide === 0}
              onClick={() => setPricingSlide((s) => Math.max(0, s - 1))}
            >
              ←
            </button>
            <div className="landing-pricing-carousel-dots" role="tablist" aria-label="Plans">
              <button
                type="button"
                role="tab"
                aria-label="Beta access"
                aria-selected={pricingSlide === 0}
                className={`landing-pricing-carousel-dot${pricingSlide === 0 ? ' is-active' : ''}`}
                onClick={() => setPricingSlide(0)}
              />
              <button
                type="button"
                role="tab"
                aria-label="Individual plan"
                aria-selected={pricingSlide === 1}
                className={`landing-pricing-carousel-dot${pricingSlide === 1 ? ' is-active' : ''}`}
                onClick={() => setPricingSlide(1)}
              />
            </div>
            <button
              type="button"
              className="landing-pricing-carousel-btn"
              aria-label="Next plan"
              disabled={pricingSlide === 1}
              onClick={() => setPricingSlide((s) => Math.min(1, s + 1))}
            >
              →
            </button>
          </div>
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
