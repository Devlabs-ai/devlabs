import React, { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../context/AppStateContext';
import { fetchPlatformLeaderboard, type PlatformLeaderboard } from '../services/leaderboardApi';
import { IconCoins } from '../components/ChromeIcons';
import { LeaderboardIcon } from '../components/TrackStatusIcons';

export default function PlatformLeaderboardPage(): JSX.Element {
  const { authMode, currentUser } = useAppState();
  const [board, setBoard] = useState<PlatformLeaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchPlatformLeaderboard(100)
      .then((b) => { if (!cancelled) { setBoard(b); setError(null); } })
      .catch(() => { if (!cancelled) setError('Could not load the leaderboard.'); });
    return () => { cancelled = true; };
  }, [authMode, currentUser?.email]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = board?.entries ?? [];
    return q ? all.filter((e) => e.name.toLowerCase().includes(q)) : all;
  }, [board, query]);

  return (
    <div className="app-page leaderboard-page">
      <header className="leaderboard-page-header">
        <div className="leaderboard-page-title-row">
          <LeaderboardIcon className="leaderboard-header-icon" title="" />
          <h1 className="leaderboard-page-title">Leaderboard</h1>
        </div>
        <p className="leaderboard-sub">
          Lifetime tokens across DevSetu, from solved labs and Paper of the Month quizzes.
        </p>
      </header>

      {board?.me && (
        <div className="leaderboard-page-me">
          You are <strong>#{board.me.rank}</strong> of {board.participants} with{' '}
          <strong>{board.me.tokens}</strong> tokens.
        </div>
      )}

      <section className="leaderboard-page-card">
        <div className="leaderboard-page-toolbar">
          <label className="play-search">
            <span className="sr-only">Search learners</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search learners…"
            />
          </label>
          {board && (
            <span className="leaderboard-foot">
              {board.participants} learner{board.participants === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {error && <div className="alert">{error}</div>}
        {!error && !board && (
          <div className="leaderboard-empty"><span className="spinner" /> Loading…</div>
        )}
        {board && board.entries.length === 0 && (
          <div className="leaderboard-empty">No tokens earned yet. Solve a lab to take the top spot.</div>
        )}
        {board && board.entries.length > 0 && (
          <>
            <div className="leaderboard-head leaderboard-head--platform">
              <span>#</span>
              <span>Learner</span>
              <span>Labs</span>
              <span>Papers</span>
              <span>Tokens</span>
            </div>
            {rows.length === 0 ? (
              <div className="leaderboard-empty">No learners match “{query}”.</div>
            ) : (
              <ol className="leaderboard-list leaderboard-list--full">
                {rows.map((e) => (
                  <li
                    key={`${e.rank}-${e.name}`}
                    className={`leaderboard-row leaderboard-row--platform${e.isMe ? ' leaderboard-row--me' : ''}`}
                  >
                    <span className={`leaderboard-rank${e.rank <= 3 ? ` leaderboard-rank--${e.rank}` : ''}`}>{e.rank}</span>
                    <span className="leaderboard-name" title={e.name}>
                      <span className="leaderboard-name-text">{e.name}</span>
                      {e.isMe && <span className="leaderboard-you">You</span>}
                    </span>
                    <span className="leaderboard-solved">{e.solved}</span>
                    <span className="leaderboard-solved">{e.papers}</span>
                    <span className="leaderboard-tokens">
                      <IconCoins size={13} />
                      {e.tokens}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </section>
    </div>
  );
}
