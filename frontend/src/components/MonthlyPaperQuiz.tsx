import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  fetchMonthlyPaperPool,
  pickMonthlyPaper,
  submitMonthlyPaperAttempt,
  type MonthlyPaperAttempt,
  type MonthlyPaperState,
} from '../services/monthlyPaperApi';

type ApiError = { response?: { data?: { error?: string; attempt?: MonthlyPaperAttempt } }; message?: string };

export function MonthlyPaperQuizModal({
  state,
  onClose,
  onAttempt,
}: {
  state: MonthlyPaperState;
  onClose: () => void;
  onAttempt: (attempt: MonthlyPaperAttempt) => void;
}): JSX.Element {
  const { paper, tokensPerPaper, attempt } = state;
  const [answers, setAnswers] = useState<Array<number | null>>(() => paper.questions.map(() => null));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answered = answers.filter((a) => a !== null).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (): Promise<void> => {
    if (answered < paper.questions.length || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      onAttempt(await submitMonthlyPaperAttempt(paper.id, answers as number[]));
    } catch (e) {
      const err = e as ApiError;
      if (err.response?.data?.attempt) onAttempt(err.response.data.attempt);
      else setError(err.response?.data?.error || err.message || 'Could not submit your answers');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="login-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="login-modal monthly-quiz-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="monthly-quiz-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="login-card login-modal-card monthly-quiz-card">
          <header className="monthly-quiz-header">
            <div>
              <p className="monthly-paper-kicker">Paper of the Month</p>
              <h2 id="monthly-quiz-title" className="monthly-quiz-title">{paper.title}</h2>
              <p className="monthly-quiz-sub">
                {attempt
                  ? `You scored ${attempt.correct}/${attempt.total} and earned ${attempt.tokens} tokens.`
                  : `${paper.questions.length} questions · one attempt · up to ${tokensPerPaper} tokens`}
              </p>
            </div>
            <button type="button" className="ghost leaderboard-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </header>

          <ol className="monthly-quiz-list">
            {paper.questions.map((q, qi) => {
              const review = attempt?.review[qi];
              return (
                <li key={q.prompt} className="monthly-quiz-q">
                  <p className="monthly-quiz-prompt">{q.prompt}</p>
                  <div className="monthly-quiz-choices" role="radiogroup" aria-label={q.prompt}>
                    {q.choices.map((choice, ci) => {
                      const picked = review ? review.chosen === ci : answers[qi] === ci;
                      let tone = '';
                      if (review && ci === review.answer) tone = ' is-correct';
                      else if (review && picked) tone = ' is-wrong';
                      return (
                        <button
                          key={choice}
                          type="button"
                          role="radio"
                          aria-checked={picked}
                          disabled={Boolean(review)}
                          className={`monthly-quiz-choice${picked ? ' is-picked' : ''}${tone}`}
                          onClick={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? ci : a)))}
                        >
                          {choice}
                        </button>
                      );
                    })}
                  </div>
                  {review && <p className="monthly-quiz-explain">{review.explanation}</p>}
                </li>
              );
            })}
          </ol>

          {error && <div className="alert">{error}</div>}
          {!attempt && (
            <div className="monthly-quiz-foot">
              <span className="monthly-quiz-progress">
                {answered}/{paper.questions.length} answered
              </span>
              <button
                type="button"
                className="landing-cta-primary monthly-quiz-submit"
                disabled={answered < paper.questions.length || submitting}
                onClick={() => void submit()}
              >
                {submitting ? 'Submitting…' : 'Submit answers'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function MonthlyPaperAdminPicker({ currentId, onPicked }: { currentId: string; onPicked: () => void }): JSX.Element | null {
  const [papers, setPapers] = useState<Array<{ id: string; shortTitle: string }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMonthlyPaperPool().then((p) => setPapers(p.papers)).catch(() => setPapers([]));
  }, []);

  if (!papers.length) return null;
  return (
    <label className="monthly-paper-admin">
      <span>Admin · this month</span>
      <select
        value={currentId}
        disabled={busy}
        onChange={(e) => {
          setBusy(true);
          pickMonthlyPaper(e.target.value).then(onPicked).finally(() => setBusy(false));
        }}
      >
        {papers.map((p) => (
          <option key={p.id} value={p.id}>{p.shortTitle}</option>
        ))}
      </select>
    </label>
  );
}
