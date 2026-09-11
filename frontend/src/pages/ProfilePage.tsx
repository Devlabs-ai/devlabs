import React, { useEffect, useMemo, useState } from 'react';
import { PLAY_DOMAINS } from '../constants/playCatalog';
import { useAppState } from '../context/AppStateContext';
import { isAdminUser } from '../services/authApi';
import { fetchAdminSettings, saveAdminSettings } from '../services/adminApi';

export default function ProfilePage(): JSX.Element {
  const { currentUser, challenges } = useAppState();
  const isAdmin = Boolean(currentUser?.admin) || isAdminUser(currentUser);

  const [watcherEnabled, setWatcherEnabled] = useState(true);
  const [watcherLoading, setWatcherLoading] = useState(false);
  const [watcherSaving, setWatcherSaving] = useState(false);
  const [watcherError, setWatcherError] = useState<string | null>(null);
  const [clusterSynced, setClusterSynced] = useState(true);

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

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setWatcherLoading(true);
    setWatcherError(null);
    fetchAdminSettings()
      .then((s) => {
        if (cancelled) return;
        setWatcherEnabled(s.sparkJobWatcherEnabled);
        setClusterSynced(s.clusterSynced);
      })
      .catch((e: { response?: { data?: { error?: string } }; message?: string }) => {
        if (cancelled) return;
        setWatcherError(e.response?.data?.error || e.message || 'Could not load admin settings');
      })
      .finally(() => {
        if (!cancelled) setWatcherLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  async function onToggleWatcher(): Promise<void> {
    const next = !watcherEnabled;
    setWatcherSaving(true);
    setWatcherError(null);
    try {
      const s = await saveAdminSettings(next);
      setWatcherEnabled(s.sparkJobWatcherEnabled);
      setClusterSynced(s.clusterSynced);
      if (!s.clusterSynced) {
        setWatcherError('Saved, but the Spark cluster did not take the change. Try again.');
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setWatcherError(err.response?.data?.error || err.message || 'Could not save');
    } finally {
      setWatcherSaving(false);
    }
  }

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

          {isAdmin ? (
            <section className="profile-panel" aria-labelledby="profile-admin-heading">
              <h2 id="profile-admin-heading" className="profile-panel-title">Admin settings</h2>
              <div className="profile-setting-row">
                <div className="profile-setting-copy">
                  <h3>Spark job watcher</h3>
                  <p>
                    When on, the cluster kills jobs that exceed the lab hard time limit.
                    Turn off while testing long runs.
                  </p>
                </div>
                <button
                  type="button"
                  className="profile-switch"
                  role="switch"
                  aria-checked={watcherEnabled}
                  aria-label="Spark job watcher"
                  disabled={watcherLoading || watcherSaving}
                  onClick={() => void onToggleWatcher()}
                >
                  <span>{watcherEnabled ? 'On' : 'Off'}</span>
                </button>
              </div>
              {watcherLoading ? (
                <p className="profile-setting-status">Loading…</p>
              ) : null}
              {!watcherLoading && !clusterSynced && !watcherError ? (
                <p className="profile-setting-status">Cluster did not confirm the last change.</p>
              ) : null}
              {watcherError ? (
                <p className="profile-setting-status profile-setting-status--error">{watcherError}</p>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
