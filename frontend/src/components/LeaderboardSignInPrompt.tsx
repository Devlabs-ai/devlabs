import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { IconLock } from './ChromeIcons';

/** Shown in place of leaderboard data to signed-out visitors. */
export default function LeaderboardSignInPrompt({ compact = false }: { compact?: boolean }): JSX.Element {
  const { onRequestLogin } = useAppState();
  const { pathname, search } = useLocation();

  return (
    <div className={`leaderboard-signin${compact ? ' leaderboard-signin--compact' : ''}`}>
      <button
        type="button"
        className="leaderboard-lock-btn"
        onClick={() => onRequestLogin(pathname + search)}
      >
        <IconLock size={14} />
        Sign in to see the leaderboard
      </button>
    </div>
  );
}
