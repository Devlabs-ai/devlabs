import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTrackLeaderboard, type Leaderboard, type LeaderboardEntry } from '../services/leaderboardApi';
import { IconCoins } from './ChromeIcons';
import { LeaderboardIcon } from './TrackStatusIcons';
import LeaderboardSignInPrompt from './LeaderboardSignInPrompt';
import { useAppState } from '../context/AppStateContext';

interface TrackLeaderboardModalProps {
  open: boolean;
  trackLabel: string;
  challengeIds: string[];
  fullPath: string;
  onClose: () => void;
}

function EntryRow({ entry, totalLabs }: { entry: LeaderboardEntry; totalLabs: number }): JSX.Element {
  const medal = entry.rank <= 3 ? ` leaderboard-rank--${entry.rank}` : '';
  return (
    <li className={`leaderboard-row${entry.isMe ? ' leaderboard-row--me' : ''}`}>
      <span className={`leaderboard-rank${medal}`}>{entry.rank}</span>
      <span className="leaderboard-name" title={entry.name}>
        <span className="leaderboard-name-text">{entry.name}</span>
        {entry.isMe && <span className="leaderboard-you">You</span>}
      </span>
      <span className="leaderboard-solved">
        {entry.solved}
        <span className="leaderboard-of">/{totalLabs}</span>
      </span>
      <span className="leaderboard-tokens">
        <IconCoins size={13} />
        {entry.tokens}
      </span>
    </li>
  );
}

export default function TrackLeaderboardModal({
  open,
  trackLabel,
  challengeIds,
  fullPath,
  onClose,
}: TrackLeaderboardModalProps): JSX.Element | null {
  const { authMode } = useAppState();
  const signedIn = authMode === 'interviewer';
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idsKey = challengeIds.join(',');

  useEffect(() => {
    if (!open || !signedIn) return undefined;
    let cancelled = false;
    setBoard(null);
    setError(null);
    fetchTrackLeaderboard(challengeIds)
      .then((b) => { if (!cancelled) setBoard(b); })
      .catch((e: { response?: { data?: { error?: string } }; message?: string }) => {
        if (!cancelled) setError(e?.response?.data?.error || e?.message || 'Could not load leaderboard');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idsKey, signedIn]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const meOutsideTop = board?.me && !board.entries.some((e) => e.isMe) ? board.me : null;

  return (
    <div className="login-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="login-modal leaderboard-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leaderboard-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="login-card login-modal-card leaderboard-card">
          <header className="leaderboard-header">
            <LeaderboardIcon className="leaderboard-header-icon" title="" />
            <div>
              <h2 id="leaderboard-title" className="leaderboard-title">{trackLabel} leaderboard</h2>
              <p className="leaderboard-sub">Ranked by tokens earned from solved labs in this track.</p>
            </div>
            <button type="button" className="ghost leaderboard-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </header>

          {!signedIn && <LeaderboardSignInPrompt compact />}
          {signedIn && error && <div className="alert">{error}</div>}
          {signedIn && !error && !board && (
            <div className="leaderboard-empty"><span className="spinner" /> Loading…</div>
          )}
          {board && board.entries.length === 0 && (
            <div className="leaderboard-empty">No one has solved a lab in this track yet. Be the first.</div>
          )}
          {board && board.entries.length > 0 && (
            <>
              <div className="leaderboard-head">
                <span>#</span>
                <span>Learner</span>
                <span>Labs</span>
                <span>Tokens</span>
              </div>
              <ol className="leaderboard-list">
                {board.entries.map((e) => (
                  <EntryRow key={`${e.rank}-${e.name}`} entry={e} totalLabs={board.totalLabs} />
                ))}
                {meOutsideTop && (
                  <>
                    <li className="leaderboard-gap" aria-hidden="true">⋯</li>
                    <EntryRow entry={meOutsideTop} totalLabs={board.totalLabs} />
                  </>
                )}
              </ol>
              <p className="leaderboard-foot">
                {board.participants} learner{board.participants === 1 ? '' : 's'} on the board
                {!board.me ? ' · solve a lab to join' : ''}
              </p>
            </>
          )}
          {signedIn && (
            <Link to={fullPath} className="leaderboard-full-link" onClick={onClose}>
              View full leaderboard <span aria-hidden>→</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
