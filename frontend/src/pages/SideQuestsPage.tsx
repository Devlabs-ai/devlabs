import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { PLAY_DOMAINS } from '../constants/playCatalog';
import { listQuizzes, type QuizListItem } from '../services/quizApi';

function topicIdFromQuiz(quiz: QuizListItem): string {
  const fromDomain = PLAY_DOMAINS.find((d) => d.id === quiz.domainId);
  const panel = fromDomain?.panels.find(
    (p) => p.label.toLowerCase() === quiz.panelLabel.toLowerCase(),
  );
  if (panel) return panel.id;
  return quiz.panelLabel.trim().toLowerCase().replace(/\s+/g, '-') || 'general';
}

function topicMeta(topicId: string): { label: string; blurb: string } {
  for (const domain of PLAY_DOMAINS) {
    const panel = domain.panels.find((p) => p.id === topicId);
    if (panel) {
      return { label: panel.label, blurb: panel.blurb };
    }
  }
  const label = topicId
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return {
    label: label || 'General',
    blurb: 'Quirkier quizzes — no code, just Spark brain snacks.',
  };
}

export default function SideQuestsPage(): JSX.Element {
  const navigate = useNavigate();
  const { topicId } = useParams<{ topicId?: string }>();
  const [quizzes, setQuizzes] = useState<QuizListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listQuizzes()
      .then((rows) => {
        if (cancelled) return;
        setQuizzes(rows);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data
            ?.error
          || (err as { message?: string })?.message
          || 'Failed to load side quests';
        setQuizzes([]);
        setLoadError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const topics = useMemo(() => {
    const map = new Map<string, QuizListItem[]>();
    for (const quiz of quizzes) {
      const id = topicIdFromQuiz(quiz);
      const list = map.get(id) || [];
      list.push(quiz);
      map.set(id, list);
    }
    return [...map.entries()]
      .map(([id, items]) => ({
        id,
        ...topicMeta(id),
        quizzes: items.sort((a, b) => a.sideQuest.title.localeCompare(b.sideQuest.title)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [quizzes]);

  const activeTopic = topicId ? topics.find((t) => t.id === topicId) : null;

  if (topicId && !loading && !loadError && topics.length > 0 && !activeTopic) {
    return <Navigate to="/play/quests" replace />;
  }

  if (activeTopic) {
    return (
      <div className="app-page play-problems-page play-papers-page">
        <header className="play-problems-hero">
          <div className="play-problems-hero-copy">
            <p className="play-problems-kicker">
              <Link to="/play/quests" className="play-papers-crumb">
                Side Quests
              </Link>
              <span aria-hidden> / </span>
              {activeTopic.label}
            </p>
            <h1 className="play-problems-title">{activeTopic.label}</h1>
            <p className="play-problems-lead">{activeTopic.blurb}</p>
          </div>
        </header>

        <div className="play-paper-tile-grid" aria-label={`${activeTopic.label} side quests`}>
          {activeTopic.quizzes.map((quiz) => (
            <button
              key={quiz.id}
              type="button"
              className="play-paper-tile play-quest-tile"
              onClick={() => navigate(`/play/quiz/${quiz.id}`)}
              title={quiz.learningOutcome}
            >
              <span className="play-paper-tile-meta">
                {quiz.difficulty || 'Quiz'}
              </span>
              <strong className="play-paper-tile-title">{quiz.sideQuest.title}</strong>
              <span className="play-paper-tile-full">{quiz.sideQuest.subtitle}</span>
              <p className="play-paper-tile-blurb">{quiz.learningOutcome}</p>
              <span className="play-paper-tile-cta">
                Open quest
                <span aria-hidden>→</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="app-page play-problems-page play-papers-page">
      <header className="play-problems-hero">
        <div className="play-problems-hero-copy">
          <p className="play-problems-kicker">
            <Link to="/play" className="play-papers-crumb">
              Play
            </Link>
            <span aria-hidden> / </span>
            Explore
          </p>
          <h1 className="play-problems-title">Side Quests</h1>
          <p className="play-problems-lead">
            Quirkier quizzes — no code, just Spark brain snacks. Browse by topic.
          </p>
        </div>
      </header>

      {loading && <div className="alert info">Loading side quests…</div>}
      {loadError && <div className="alert app-page-alert">{loadError}</div>}
      {!loading && !loadError && topics.length === 0 && (
        <div className="alert info">No side quests published yet.</div>
      )}

      {topics.length > 0 && (
        <div className="play-paper-section-grid" aria-label="Side quest topics">
          {topics.map((topic) => (
            <Link
              key={topic.id}
              to={`/play/quests/${topic.id}`}
              className="play-paper-section-card"
            >
              <span className="play-paper-section-kicker">
                {topic.quizzes.length} quest{topic.quizzes.length === 1 ? '' : 's'}
              </span>
              <strong className="play-paper-section-title">{topic.label}</strong>
              <p className="play-paper-section-blurb">{topic.blurb}</p>
              <span className="play-paper-section-cta">
                Browse
                <span aria-hidden>→</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
