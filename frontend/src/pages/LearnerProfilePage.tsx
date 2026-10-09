import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchLearnerProfile, type LearnerProfile } from '../services/leaderboardApi';
import { LEADERBOARD_PATH } from '../constants/leaderboard';
import { IconCoins } from '../components/ChromeIcons';
import Avatar from '../components/Avatar';
import ActivityHeatmap from '../components/ActivityHeatmap';
import LeaderboardSignInPrompt from '../components/LeaderboardSignInPrompt';
import { useAppState } from '../context/AppStateContext';

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function LearnerProfilePage(): JSX.Element {
  const { learnerId = '' } = useParams<{ learnerId: string }>();
  const { authMode } = useAppState();
  const signedIn = authMode === 'interviewer';
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return undefined;
    let cancelled = false;
    setProfile(null);
    setError(null);
    fetchLearnerProfile(learnerId)
      .then((p) => { if (!cancelled) setProfile(p); })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.status === 404 ? 'This learner is not on the leaderboard.' : 'Could not load this profile.');
      });
    return () => { cancelled = true; };
  }, [learnerId, signedIn]);

  if (!signedIn) {
    return (
      <div className="app-page leaderboard-page learner-page">
        <Link to={LEADERBOARD_PATH} className="learner-back">← Leaderboard</Link>
        <section className="leaderboard-page-card">
          <LeaderboardSignInPrompt />
        </section>
      </div>
    );
  }

  return (
    <div className="app-page leaderboard-page learner-page">
      <Link to={LEADERBOARD_PATH} className="learner-back">← Leaderboard</Link>

      {error && <div className="alert">{error}</div>}
      {!error && !profile && (
        <div className="leaderboard-empty"><span className="spinner" /> Loading…</div>
      )}

      {profile && (
        <>
          <header className="learner-hero">
            <span className="learner-avatar">
              <Avatar avatar={profile.avatar} name={profile.name} size={64} />
              <span className={`leaderboard-rank learner-rank${profile.rank <= 3 ? ` leaderboard-rank--${profile.rank}` : ''}`}>
                {profile.rank}
              </span>
            </span>
            <div className="learner-hero-copy">
              <h1 className="leaderboard-page-title">
                {profile.name}
                {profile.isMe && <span className="leaderboard-you">You</span>}
              </h1>
              <p className="leaderboard-sub">
                Rank #{profile.rank} of {profile.participants} learners
              </p>
            </div>
          </header>

          <div className="learner-stats">
            <div className="learner-stat">
              <strong><IconCoins size={15} />{profile.tokens}</strong>
              <span>Tokens</span>
            </div>
            <div className="learner-stat">
              <strong>{profile.solved}</strong>
              <span>Labs solved</span>
            </div>
            <div className="learner-stat">
              <strong>{profile.papers}</strong>
              <span>Papers</span>
            </div>
          </div>

          <section className="leaderboard-page-card learner-section" aria-labelledby="learner-activity">
            <h2 id="learner-activity" className="learner-section-title">Activity</h2>
            <ActivityHeatmap activity={profile.activity} />
          </section>

          <section className="leaderboard-page-card learner-section" aria-labelledby="learner-labs">
            <h2 id="learner-labs" className="learner-section-title">Solved labs</h2>
            {profile.solvedLabs.length === 0 ? (
              <p className="leaderboard-empty">No labs solved yet.</p>
            ) : (
              <ul className="learner-list">
                {profile.solvedLabs.map((lab) => (
                  <li key={`${lab.title}-${lab.solvedAt}`} className="learner-item">
                    <span className="learner-item-title">{lab.title}</span>
                    {lab.difficulty && <span className="learner-item-meta">{lab.difficulty}</span>}
                    <span className="learner-item-meta">{formatDate(lab.solvedAt)}</span>
                    <span className="leaderboard-tokens"><IconCoins size={12} />{lab.tokens}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {profile.paperQuizzes.length > 0 && (
            <section className="leaderboard-page-card learner-section" aria-labelledby="learner-papers">
              <h2 id="learner-papers" className="learner-section-title">Paper quizzes</h2>
              <ul className="learner-list">
                {profile.paperQuizzes.map((paper) => (
                  <li key={`${paper.title}-${paper.takenAt}`} className="learner-item">
                    <span className="learner-item-title">{paper.title}</span>
                    <span className="learner-item-meta">{paper.correct}/{paper.total} correct</span>
                    <span className="learner-item-meta">{formatDate(paper.takenAt)}</span>
                    <span className="leaderboard-tokens"><IconCoins size={12} />{paper.tokens}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
