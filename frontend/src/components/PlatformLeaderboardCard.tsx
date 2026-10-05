import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { LEADERBOARD_PATH } from '../constants/leaderboard';
import {
  fetchPlatformLeaderboard,
  type PlatformLeaderboard,
  type PlatformLeaderboardEntry,
} from '../services/leaderboardApi';
import { IconCoins } from './ChromeIcons';

function Row({ entry }: { entry: PlatformLeaderboardEntry }): JSX.Element {
  const medal = entry.rank <= 3 ? ` leaderboard-rank--${entry.rank}` : '';
  return (
    <li className={`platform-lb-row${entry.isMe ? ' platform-lb-row--me' : ''}`}>
      <span className={`leaderboard-rank${medal}`}>{entry.rank}</span>
      <span className="platform-lb-name" title={entry.name}>
        {entry.name}
        {entry.isMe && <span className="leaderboard-you">You</span>}
      </span>
      <span className="platform-lb-tokens">
        <IconCoins size={12} />
        {entry.tokens}
      </span>
    </li>
  );
}

/** Top learners by lifetime tokens; `refreshKey` reloads it after the caller earns more. */
export default function PlatformLeaderboardCard({ refreshKey = 0 }: { refreshKey?: number }): JSX.Element {
  const { authMode, currentUser } = useAppState();
  const [board, setBoard] = useState<PlatformLeaderboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPlatformLeaderboard(10)
      .then((b) => { if (!cancelled) { setBoard(b); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [refreshKey, authMode, currentUser?.email]);

  const meOutsideTop = board?.me && !board.entries.some((e) => e.isMe) ? board.me : null;

  return (
    <section className="play-sidebar-card platform-lb" aria-label="Platform leaderboard">
      <p className="monthly-paper-kicker">Leaderboard</p>
      <p className="platform-lb-sub">Lifetime tokens from labs and papers.</p>
      {failed && <p className="platform-lb-empty">Could not load the leaderboard.</p>}
      {!failed && !board && <p className="platform-lb-empty"><span className="spinner" /> Loading…</p>}
      {board && board.entries.length === 0 && (
        <p className="platform-lb-empty">No tokens earned yet. Solve a lab to take the top spot.</p>
      )}
      {board && board.entries.length > 0 && (
        <ol className="platform-lb-list">
          {board.entries.map((e) => <Row key={`${e.rank}-${e.name}`} entry={e} />)}
          {meOutsideTop && (
            <>
              <li className="leaderboard-gap" aria-hidden="true">⋯</li>
              <Row entry={meOutsideTop} />
            </>
          )}
        </ol>
      )}
      <Link to={LEADERBOARD_PATH} className="platform-lb-all">
        View full leaderboard →
      </Link>
    </section>
  );
}
