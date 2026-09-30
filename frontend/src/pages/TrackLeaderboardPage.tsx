import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  getPlayDomain,
  getPlayPanel,
  isPlayDomainId,
  playCatalogPath,
  type PlayDomainId,
  type PlayPanelId,
} from '../constants/playCatalog';
import { fetchTrackLeaderboard, type Leaderboard } from '../services/leaderboardApi';
import { IconCoins } from '../components/ChromeIcons';
import { LeaderboardIcon } from '../components/TrackStatusIcons';

const FULL_LIMIT = 1000;

function formatDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function TrackLeaderboardPage(): JSX.Element {
  const params = useParams<{ domainId?: string; panelId?: string }>();
  const domainId = isPlayDomainId(params.domainId) ? (params.domainId as PlayDomainId) : null;
  const domain = getPlayDomain(domainId);
  const panel = getPlayPanel(domain, (params.panelId || null) as PlayPanelId | null);
  const challengeIds = panel?.challengeIds ?? [];
  const idsKey = challengeIds.join(',');

  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!challengeIds.length) return undefined;
    let cancelled = false;
    setBoard(null);
    setError(null);
    fetchTrackLeaderboard(challengeIds, FULL_LIMIT)
      .then((b) => { if (!cancelled) setBoard(b); })
      .catch((e: { response?: { data?: { error?: string } }; message?: string }) => {
        if (!cancelled) setError(e?.response?.data?.error || e?.message || 'Could not load leaderboard');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = board?.entries ?? [];
    return q ? all.filter((e) => e.name.toLowerCase().includes(q)) : all;
  }, [board, query]);

  if (!domain || !panel || !challengeIds.length) return <Navigate to="/play" replace />;

  const trackPath = playCatalogPath(domain.id, panel.id);

  return (
    <div className="app-page leaderboard-page">
      <header className="leaderboard-page-header">
        <p className="spark-primer-crumb">
          <Link to="/play">Tracks</Link>
          <span aria-hidden> / </span>
          <Link to={playCatalogPath(domain.id)}>{domain.label}</Link>
          <span aria-hidden> / </span>
          <Link to={trackPath}>{panel.label}</Link>
          <span aria-hidden> / </span>
          Leaderboard
        </p>
        <div className="leaderboard-page-title-row">
          <LeaderboardIcon className="leaderboard-header-icon" title="" />
          <h1 className="leaderboard-page-title">{panel.label} leaderboard</h1>
        </div>
        <p className="leaderboard-sub">
          Ranked by tokens earned from solved labs in this track. Ties go to more labs solved, then to whoever got there first.
        </p>
      </header>

      {board?.me && (
        <div className="leaderboard-page-me">
          You are <strong>#{board.me.rank}</strong> of {board.participants} with{' '}
          <strong>{board.me.solved}/{board.totalLabs}</strong> labs and <strong>{board.me.tokens}</strong> tokens.
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
          <div className="leaderboard-empty">No one has solved a lab in this track yet. Be the first.</div>
        )}
        {board && board.entries.length > 0 && (
          <>
            <div className="leaderboard-head leaderboard-head--full">
              <span>#</span>
              <span>Learner</span>
              <span>Labs</span>
              <span>Tokens</span>
              <span>Last solved</span>
            </div>
            {rows.length === 0 ? (
              <div className="leaderboard-empty">No learners match “{query}”.</div>
            ) : (
              <ol className="leaderboard-list leaderboard-list--full">
                {rows.map((e) => (
                  <li
                    key={`${e.rank}-${e.name}`}
                    className={`leaderboard-row leaderboard-row--full${e.isMe ? ' leaderboard-row--me' : ''}`}
                  >
                    <span className={`leaderboard-rank${e.rank <= 3 ? ` leaderboard-rank--${e.rank}` : ''}`}>{e.rank}</span>
                    <span className="leaderboard-name" title={e.name}>
                      <span className="leaderboard-name-text">{e.name}</span>
                      {e.isMe && <span className="leaderboard-you">You</span>}
                    </span>
                    <span className="leaderboard-solved">
                      {e.solved}
                      <span className="leaderboard-of">/{board.totalLabs}</span>
                    </span>
                    <span className="leaderboard-tokens">
                      <IconCoins size={13} />
                      {e.tokens}
                    </span>
                    <span className="leaderboard-date">{formatDate(e.lastSolvedAt)}</span>
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
