import React, { useEffect, useRef, useState } from 'react';
import MarketingPageShell, { useMarketing } from '../components/MarketingPageShell';
import {
  ProjectsAnim,
  TracksAnim,
  WhiteboardAnim,
} from '../components/LandingFeatureAnims';
import { Link } from 'react-router-dom';
import { PRICING_PATH } from '../constants/pricing';
import { useInView } from '../hooks/useInView';

interface LandingPageProps {
  onSignIn: () => void;
  onGetStarted: () => void;
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
  const { openLogin, getStarted } = useMarketing();
  const platformReveal = useInView<HTMLElement>();
  const offer1 = useInView<HTMLElement>();
  const offer2 = useInView<HTMLElement>();
  const offer3 = useInView<HTMLElement>();
  const pricingReveal = useInView<HTMLElement>();

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
          <div className="landing-cta landing-cta--pair">
            <button type="button" className="landing-cta-primary" onClick={getStarted}>
              Get started
              <span className="landing-cta-arrow" aria-hidden>
                →
              </span>
            </button>
            <button type="button" className="landing-cta-secondary" onClick={openLogin}>
              Sign in
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
        className={`landing-afford${pricingReveal.inView ? ' is-inview' : ''}`}
        aria-label="Pricing"
      >
        <div className="landing-afford-intro">
          <p className="landing-kicker">The pricing</p>
          <h2 className="landing-section-title landing-section-title--punch">
            <span className="landing-hero-line">Affordable</span>
            <span className="landing-hero-line landing-hero-line--accent">by design</span>
          </h2>
          <p className="landing-section-lead">
            DevSetu is built for students, early-career engineers, and anyone curious about how
            real systems actually work — people who learn best by doing, but can&rsquo;t pay for
            a cloud account per experiment. We run every lab on optimized shared infrastructure, so you
            get real systems without the real bill.
          </p>
          <ul className="landing-afford-reasons">
            <li>Pay only for what you need. Finish it, then go beyond.</li>
            <li>No cloud setup, no surprise charges for a cluster you forgot to delete.</li>
            <li>Priced for a learner&rsquo;s budget, not a company training budget.</li>
          </ul>
        </div>

        <aside className="landing-tokens" aria-label="Lab tokens">
          <h3 className="landing-tokens-title">Every lab you solve pays you back.</h3>
          <p className="landing-tokens-body">
            Solving a lab earns you <strong>tokens</strong>. Cash them out into DevSetu credit and
            spend it on your next track or project — the more you practice, the less you pay.
          </p>
          <ol className="landing-tokens-steps">
            <li><span>1</span>Solve a lab</li>
            <li><span>2</span>Earn tokens</li>
            <li><span>3</span>Cash out to credit</li>
            <li><span>4</span>Unlock more tracks &amp; projects</li>
          </ol>
          <Link to={PRICING_PATH} className="landing-tokens-link">
            View pricing <span aria-hidden>→</span>
          </Link>
        </aside>
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
