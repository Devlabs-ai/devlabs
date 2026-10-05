import React, { useState } from 'react';
import { useAppState } from '../context/AppStateContext';
import { isAdminUser } from '../services/authApi';
import { useMonthlyPaper } from '../hooks/useMonthlyPaper';
import { monthLabel } from '../constants/monthlyPaper';
import { IconCoins } from '../components/ChromeIcons';
import { MonthlyPaperAdminPicker, MonthlyPaperQuizModal } from '../components/MonthlyPaperQuiz';
import type { MonthlyPaperMeta } from '../services/monthlyPaperApi';

function TokenBadge({ label, title }: { label: string; title: string }): JSX.Element {
  return (
    <span className="monthly-tile-tokens" title={title}>
      <IconCoins size={13} />
      {label}
    </span>
  );
}

function PaperTile({
  paper,
  month,
  current,
  badge,
  children,
}: {
  paper: MonthlyPaperMeta;
  month: string;
  current?: boolean;
  badge?: JSX.Element | null;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <article className={`monthly-tile${current ? ' is-current' : ''}`}>
      <header className="monthly-tile-top">
        <p className="monthly-paper-kicker">
          {month}
          {current && <span className="monthly-tile-now">This month</span>}
        </p>
        {badge}
      </header>
      <h2 className="monthly-tile-title">{paper.title}</h2>
      <p className="monthly-tile-meta" title={paper.authors}>
        {paper.venue} {paper.year} · {paper.authors}
      </p>
      <p className="monthly-tile-blurb">{paper.blurb}</p>
      <div className="monthly-tile-actions">
        <a className="monthly-tile-btn" href={paper.href} target="_blank" rel="noreferrer">
          Read paper <span aria-hidden>↗</span>
        </a>
        {children}
      </div>
    </article>
  );
}

export default function MonthlyPaperPage(): JSX.Element {
  const { authMode, currentUser, onRequestLogin } = useAppState();
  const signedIn = authMode === 'interviewer';
  const { state, reload, setState } = useMonthlyPaper();
  const [quizOpen, setQuizOpen] = useState(false);

  const openQuiz = (): void => {
    if (!signedIn) {
      onRequestLogin();
      return;
    }
    setQuizOpen(true);
  };

  const attempt = state?.attempt;

  return (
    <div className="app-page play-problems-page monthly-page">
      <header className="play-problems-hero">
        <div className="play-problems-hero-copy">
          <h1 className="play-problems-title">Paper of the Month</h1>
          <p className="play-problems-lead">
            One landmark systems paper each month. Read it, answer five questions, and earn
            tokens for what you understood.
          </p>
        </div>
      </header>

      {state && (
        <>
          <section className="monthly-grid" aria-label="Papers">
            <PaperTile
              paper={state.paper}
              month={monthLabel(state.pickedAt)}
              current
              badge={
                attempt ? (
                  <TokenBadge label={`+${attempt.tokens}`} title={`${attempt.correct}/${attempt.total} correct`} />
                ) : (
                  <TokenBadge label={String(state.tokensPerPaper)} title={`Earn up to ${state.tokensPerPaper} tokens`} />
                )
              }
            >
              <button type="button" className="monthly-tile-btn" onClick={attempt ? () => setQuizOpen(true) : openQuiz}>
                {attempt ? 'Review answers' : 'Test yourself'}
              </button>
            </PaperTile>

            {state.earlier.map((p) => (
              <PaperTile
                key={p.id}
                paper={p}
                month={monthLabel(p.pickedAt)}
                badge={
                  p.score ? (
                    <TokenBadge label={`+${p.score.tokens}`} title={`${p.score.correct}/${p.score.total} correct`} />
                  ) : null
                }
              />
            ))}
          </section>

          {isAdminUser(currentUser) && (
            <div className="monthly-admin">
              <MonthlyPaperAdminPicker currentId={state.paper.id} onPicked={reload} />
            </div>
          )}

          {quizOpen && (
            <MonthlyPaperQuizModal
              state={state}
              onClose={() => setQuizOpen(false)}
              onAttempt={(a) => {
                setState((prev) => (prev ? { ...prev, attempt: a } : prev));
                reload();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
