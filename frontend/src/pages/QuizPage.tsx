import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import ReadOnlyCodePane from '../components/ReadOnlyCodePane';
import {
  fetchQuiz,
  type PlayQuiz,
  type QuizQuestion,
} from '../services/quizApi';

type Answers = Record<string, string>;

function normalizeAnswer(q: QuizQuestion, raw: string): string | number | boolean | null {
  const t = raw.trim();
  if (!t && q.type !== 'true_false') return null;
  if (q.type === 'number') {
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  if (q.type === 'true_false') {
    if (t === 'true') return true;
    if (t === 'false') return false;
    return null;
  }
  return t;
}

function isCorrect(q: QuizQuestion, raw: string): boolean {
  const value = normalizeAnswer(q, raw);
  if (value === null) return false;
  return value === q.correctAnswer;
}

export default function QuizPage(): JSX.Element {
  const { quizId } = useParams<{ quizId: string }>();
  const [quiz, setQuiz] = useState<PlayQuiz | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Answers>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!quizId) {
      setLoading(false);
      setLoadError('Missing quiz id');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setAnswers({});
    setSubmitted(false);
    void fetchQuiz(quizId)
      .then((q) => {
        if (!cancelled) setQuiz(q);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data
            ?.error ||
          (err as { message?: string })?.message ||
          'Failed to load quiz from MinIO';
        setQuiz(null);
        setLoadError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  const score = useMemo(() => {
    if (!quiz || !submitted) return null;
    let correct = 0;
    for (const q of quiz.questions) {
      if (isCorrect(q, answers[q.id] ?? '')) correct += 1;
    }
    return { correct, total: quiz.questions.length, ratio: correct / quiz.questions.length };
  }, [quiz, answers, submitted]);

  if (!quizId) {
    return <Navigate to="/play" replace />;
  }

  if (loading) {
    return (
      <div className="app-page app-page-centered">
        <div className="loading-card app-surface-card">
          <span className="spinner" />
          <div>Loading quiz from MinIO…</div>
        </div>
      </div>
    );
  }

  if (loadError || !quiz) {
    return (
      <div className="app-page app-page-centered">
        <div className="score-card app-surface-card">
          <h2>Quiz unavailable</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {loadError || 'Quiz not found in MinIO. Publish it with ./bin/publish-quiz.sh.'}
          </p>
        </div>
      </div>
    );
  }

  const passed = score != null && score.ratio >= quiz.passScore;

  return (
    <div className="play-quiz-shell">
      <header className="play-quiz-top">
        <div className="play-quiz-top-copy">
          <h1 className="play-quiz-title">{quiz.title}</h1>
          <p className="play-quiz-lead">{quiz.learningOutcome}</p>
        </div>
        <div className="play-quiz-top-actions">
          {quiz.exhibit.historyUrl ? (
            <a
              className="play-quiz-history-btn"
              href={quiz.exhibit.historyUrl}
              target="_blank"
              rel="noreferrer"
              title={quiz.exhibit.historyAppId || quiz.exhibit.historyUrl}
            >
              History Server
            </a>
          ) : (
            <span
              className="play-quiz-history-btn play-quiz-history-btn--disabled"
              title="Set historyUrl in quizzes/<id>/metadata.json"
            >
              History Server
            </span>
          )}
          {!submitted ? (
            <button type="button" className="play-quiz-submit-btn" onClick={() => setSubmitted(true)}>
              Submit quiz
            </button>
          ) : (
            <>
              <span className={`play-quiz-top-score${passed ? ' pass' : ' fail'}`}>
                {score?.correct}/{score?.total}
                {passed ? ' passed' : ' — retry'}
              </span>
              <button
                type="button"
                className="play-quiz-submit-btn secondary"
                onClick={() => {
                  setSubmitted(false);
                  setAnswers({});
                }}
              >
                Retry
              </button>
            </>
          )}
        </div>
      </header>

      <div className="play-quiz-split">
        <section className="play-quiz-pane play-quiz-pane--questions" aria-label="Questionnaire">
          <ol className="play-quiz-questions">
            {quiz.questions.map((q, index) => {
              const raw = answers[q.id] ?? '';
              const showResult = submitted;
              const ok = showResult && isCorrect(q, raw);
              const bad = showResult && !ok;

              return (
                <li
                  key={q.id}
                  className={`play-quiz-question${ok ? ' is-correct' : ''}${bad ? ' is-wrong' : ''}`}
                >
                  <div className="play-quiz-question-head">
                    <span className="play-quiz-qnum">{index + 1}</span>
                    <div>
                      <p className="play-quiz-prompt">{q.prompt}</p>
                      {q.requiresHistory && q.historyHint && (
                        <p className="play-quiz-hint">History: {q.historyHint}</p>
                      )}
                    </div>
                  </div>

                  {q.type === 'mcq' && q.choices && (
                    <div
                      className="play-quiz-choices"
                      role="radiogroup"
                      aria-label={`Question ${index + 1}`}
                    >
                      {q.choices.map((choice) => (
                        <label key={choice} className="play-quiz-choice">
                          <input
                            type="radio"
                            name={q.id}
                            value={choice}
                            checked={raw === choice}
                            disabled={submitted}
                            onChange={() =>
                              setAnswers((prev) => ({ ...prev, [q.id]: choice }))
                            }
                          />
                          <span>{choice}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {q.type === 'number' && (
                    <input
                      type="number"
                      className="play-quiz-number"
                      value={raw}
                      disabled={submitted}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                      }
                    />
                  )}

                  {q.type === 'true_false' && (
                    <div
                      className="play-quiz-choices"
                      role="radiogroup"
                      aria-label={`Question ${index + 1}`}
                    >
                      {(['true', 'false'] as const).map((choice) => (
                        <label key={choice} className="play-quiz-choice">
                          <input
                            type="radio"
                            name={q.id}
                            value={choice}
                            checked={raw === choice}
                            disabled={submitted}
                            onChange={() =>
                              setAnswers((prev) => ({ ...prev, [q.id]: choice }))
                            }
                          />
                          <span>{choice === 'true' ? 'True' : 'False'}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {showResult && (
                    <p className={`play-quiz-feedback${ok ? ' ok' : ' bad'}`}>
                      {ok ? 'Correct. ' : 'Not quite. '}
                      {q.explanation}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="play-quiz-pane play-quiz-pane--code" aria-label="Exhibit code">
          <div className="play-quiz-code-head">
            <span className="play-quiz-code-path">{quiz.exhibit.codePath}</span>
            <span className="play-quiz-code-meta">Frozen submission</span>
          </div>
          <div className="play-quiz-code-body">
            <ReadOnlyCodePane
              path={quiz.exhibit.codePath}
              content={quiz.exhibit.code}
              fill
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
