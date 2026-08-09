import React, { useMemo } from 'react';
import { PLAY_DOMAINS } from '../constants/playCatalog';
import { useAppState } from '../context/AppStateContext';

export default function ProfilePage(): JSX.Element {
  const { currentUser, challenges } = useAppState();

  const finalizedCount = useMemo(
    () => challenges.filter((c) => c.finalized).length,
    [challenges],
  );
  const solvedCount = useMemo(
    () => challenges.filter((c) => c.solved && c.finalized).length,
    [challenges],
  );
  const trackCount = useMemo(
    () => PLAY_DOMAINS.filter((d) => d.panels.some((p) => p.challengeIds.length)).length,
    [],
  );

  return (
    <div className="app-page profile-page">
      <div className="profile-shell">
        <header className="profile-hero">
          <p className="profile-eyebrow">Account</p>
          <h1 className="profile-title">Profile</h1>
          <p className="profile-lead">
            {currentUser?.email ? `Signed in as ${currentUser.email}` : 'Your account.'}
          </p>
        </header>

        <div className="profile-stack">
          <section className="profile-panel" aria-labelledby="profile-account-heading">
            <h2 id="profile-account-heading" className="profile-panel-title">Account</h2>
            <dl className="profile-account-dl">
              <div>
                <dt>Email</dt>
                <dd>{currentUser?.email || '—'}</dd>
              </div>
              {currentUser?.name ? (
                <div>
                  <dt>Name</dt>
                  <dd>{currentUser.name}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="profile-panel" aria-labelledby="profile-progress-heading">
            <h2 id="profile-progress-heading" className="profile-panel-title">Your progress</h2>
            <div className="profile-progress-metrics">
              <div className="profile-progress-hero">
                <strong>{solvedCount}</strong>
                <span>/{Math.max(finalizedCount, 1)}</span>
                <em>solved</em>
              </div>
              <div className="profile-progress-grid">
                <div>
                  <span>Available</span>
                  <strong>{finalizedCount}</strong>
                </div>
                <div>
                  <span>Tracks</span>
                  <strong>{trackCount}</strong>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
