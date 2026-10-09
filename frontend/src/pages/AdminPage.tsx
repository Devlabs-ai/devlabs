import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isAdminUser } from '../services/authApi';
import {
  approveAdminUser,
  fetchAdminSettings,
  fetchAdminUsers,
  rejectAdminUser,
  saveAdminSettings,
  updateAdminUserRole,
  type AdminUser,
} from '../services/adminApi';
import {
  REVIEW_TRACKS,
  USER_ROLE_LABELS,
  USER_ROLES,
  type UserRole,
  reviewTrackLabel,
  userRoleLabel,
} from '../constants/roles';

type RoleDraft = {
  role: UserRole;
  reviewTracks: string[];
};

const DEFAULT_DRAFT: RoleDraft = { role: 'learner', reviewTracks: [] };

function draftFromUser(user: AdminUser): RoleDraft {
  const role = (user.role && USER_ROLES.includes(user.role) ? user.role : 'learner') as UserRole;
  return {
    role: user.admin ? 'admin' : role,
    reviewTracks: role === 'reviewer' ? [...(user.reviewTracks || [])] : [],
  };
}

export default function AdminPage(): JSX.Element {
  const { currentUser } = useAppState();
  const isAdmin = Boolean(currentUser?.admin) || isAdminUser(currentUser);

  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [watcherEnabled, setWatcherEnabled] = useState(true);
  const [clusterSynced, setClusterSynced] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [pending, setPending] = useState<AdminUser[]>([]);
  const [active, setActive] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RoleDraft>>({});
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const [pendingUsers, activeUsers] = await Promise.all([
        fetchAdminUsers('pending'),
        fetchAdminUsers('active'),
      ]);
      setPending(pendingUsers);
      setActive(activeUsers);
      setDrafts((prev) => {
        const next: Record<string, RoleDraft> = { ...prev };
        for (const u of [...pendingUsers, ...activeUsers]) {
          if (!next[u.id]) next[u.id] = draftFromUser(u);
        }
        return next;
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setUsersError(err.response?.data?.error || err.message || 'Could not load users');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setSettingsLoading(true);
    setSettingsError(null);
    fetchAdminSettings()
      .then((s) => {
        if (cancelled) return;
        setRegistrationOpen(s.registrationOpen);
        setWatcherEnabled(s.sparkJobWatcherEnabled);
        setClusterSynced(s.clusterSynced);
      })
      .catch((e: { response?: { data?: { error?: string } }; message?: string }) => {
        if (cancelled) return;
        setSettingsError(e.response?.data?.error || e.message || 'Could not load settings');
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    void loadUsers();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, loadUsers]);

  if (!isAdmin) {
    return <Navigate to="/profile" replace />;
  }

  function getDraft(userId: string): RoleDraft {
    return drafts[userId] || DEFAULT_DRAFT;
  }

  function setDraft(userId: string, patch: Partial<RoleDraft>): void {
    setDrafts((prev) => {
      const current = prev[userId] || DEFAULT_DRAFT;
      const nextRole = patch.role ?? current.role;
      return {
        ...prev,
        [userId]: {
          role: nextRole,
          reviewTracks:
            nextRole === 'reviewer'
              ? patch.reviewTracks !== undefined
                ? patch.reviewTracks
                : current.reviewTracks
              : [],
        },
      };
    });
  }

  function toggleTrack(userId: string, trackId: string): void {
    const draft = getDraft(userId);
    const has = draft.reviewTracks.includes(trackId);
    const reviewTracks = has
      ? draft.reviewTracks.filter((t) => t !== trackId)
      : [...draft.reviewTracks, trackId];
    setDraft(userId, { reviewTracks });
  }

  async function onToggleRegistration(): Promise<void> {
    const next = !registrationOpen;
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const s = await saveAdminSettings({ registrationOpen: next });
      setRegistrationOpen(s.registrationOpen);
      setWatcherEnabled(s.sparkJobWatcherEnabled);
      setClusterSynced(s.clusterSynced);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setSettingsError(err.response?.data?.error || err.message || 'Could not save');
    } finally {
      setSettingsSaving(false);
    }
  }

  async function onToggleWatcher(): Promise<void> {
    const next = !watcherEnabled;
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const s = await saveAdminSettings({ sparkJobWatcherEnabled: next });
      setWatcherEnabled(s.sparkJobWatcherEnabled);
      setRegistrationOpen(s.registrationOpen);
      setClusterSynced(s.clusterSynced);
      if (!s.clusterSynced) {
        setSettingsError('Saved, but the Spark cluster did not take the change. Try again.');
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setSettingsError(err.response?.data?.error || err.message || 'Could not save');
    } finally {
      setSettingsSaving(false);
    }
  }

  async function onApprove(userId: string): Promise<void> {
    const draft = getDraft(userId);
    if (draft.role === 'reviewer' && draft.reviewTracks.length === 0) {
      setUsersError('Pick at least one track for a reviewer.');
      return;
    }
    setActionId(userId);
    setUsersError(null);
    try {
      await approveAdminUser(userId, draft);
      await loadUsers();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setUsersError(err.response?.data?.error || err.message || 'Approve failed');
    } finally {
      setActionId(null);
    }
  }

  async function onSaveRole(userId: string): Promise<void> {
    const draft = getDraft(userId);
    if (draft.role === 'reviewer' && draft.reviewTracks.length === 0) {
      setUsersError('Pick at least one track for a reviewer.');
      return;
    }
    setActionId(userId);
    setUsersError(null);
    try {
      await updateAdminUserRole(userId, draft);
      await loadUsers();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setUsersError(err.response?.data?.error || err.message || 'Could not update role');
    } finally {
      setActionId(null);
    }
  }

  async function onReject(userId: string): Promise<void> {
    setActionId(userId);
    setUsersError(null);
    try {
      await rejectAdminUser(userId);
      await loadUsers();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setUsersError(err.response?.data?.error || err.message || 'Reject failed');
    } finally {
      setActionId(null);
    }
  }

  function renderRoleControls(user: AdminUser): JSX.Element {
    const draft = getDraft(user.id);
    return (
      <div className="admin-role-controls">
        <label className="admin-role-field">
          <span className="admin-role-label">Role</span>
          <select
            className="admin-role-select"
            value={draft.role}
            aria-label={`Role for ${user.email}`}
            onChange={(e) => setDraft(user.id, { role: e.target.value as UserRole })}
          >
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {USER_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
        {draft.role === 'reviewer' ? (
          <fieldset className="admin-track-fieldset">
            <legend>Allowed review tracks</legend>
            <p className="admin-track-hint">
              Choose which Play tracks this reviewer can review.
            </p>
            <div className="admin-track-list">
              {REVIEW_TRACKS.map((track) => {
                const checked = draft.reviewTracks.includes(track.id);
                return (
                  <label key={track.id} className="admin-track-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTrack(user.id, track.id)}
                    />
                    <span>{track.label}</span>
                  </label>
                );
              })}
            </div>
            {draft.reviewTracks.length > 0 ? (
              <div className="admin-track-chips" aria-label="Selected tracks">
                {draft.reviewTracks.map((id) => (
                  <span key={id} className="admin-track-chip">
                    {reviewTrackLabel(id)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="admin-track-hint admin-track-hint--warn">
                Select at least one track before approving or saving.
              </p>
            )}
          </fieldset>
        ) : null}
      </div>
    );
  }

  function renderUserRow(
    user: AdminUser,
    actions: 'pending' | 'active',
  ): JSX.Element {
    const busy = actionId === user.id;
    const draft = getDraft(user.id);
    const dirty =
      actions === 'active' &&
      (draft.role !== (user.admin ? 'admin' : user.role || 'learner') ||
        JSON.stringify(draft.reviewTracks) !==
          JSON.stringify(user.role === 'reviewer' ? user.reviewTracks || [] : []));

    return (
      <li key={user.id} className="admin-user-row">
        <div className="admin-user-main">
          <div className="admin-user-meta">
            <strong>{user.email}</strong>
            {user.name ? <span>{user.name}</span> : null}
            {actions === 'active' ? (
              <span className="admin-user-role-badge">
                {userRoleLabel(user.role)}
                {user.role === 'reviewer' && (user.reviewTracks || []).length > 0
                  ? ` · ${(user.reviewTracks || []).map(reviewTrackLabel).join(', ')}`
                  : null}
              </span>
            ) : null}
          </div>
          {renderRoleControls(user)}
        </div>
        <div className="admin-user-actions">
          {actions === 'pending' ? (
            <>
              <button
                type="button"
                className="admin-btn admin-btn--approve"
                disabled={busy}
                onClick={() => void onApprove(user.id)}
              >
                {busy ? '…' : 'Approve'}
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--reject"
                disabled={busy}
                onClick={() => void onReject(user.id)}
              >
                Reject
              </button>
            </>
          ) : null}
          {actions === 'active' ? (
            <button
              type="button"
              className="admin-btn admin-btn--approve"
              disabled={busy || !dirty}
              onClick={() => void onSaveRole(user.id)}
            >
              {busy ? '…' : 'Save role'}
            </button>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <div className="app-page profile-page admin-page">
      <div className="profile-shell">
        <header className="profile-hero">
          <p className="profile-eyebrow">Platform</p>
          <h1 className="profile-title">Admin</h1>
          <p className="profile-lead">
            Approve signups, assign roles (Admin, Reviewer, Learner), and manage platform settings.
          </p>
        </header>

        <div className="profile-stack">
          <section className="profile-panel" aria-labelledby="admin-insights-heading">
            <h2 id="admin-insights-heading" className="profile-panel-title">
              Insights
            </h2>
            <Link to="/admin/feedback" className="admin-insight-link">
              <span className="admin-insight-copy">
                <strong>Lab feedback</strong>
                <span>Feedback from reviewers and admins across every lab, with trends and filters.</span>
              </span>
              <span className="admin-insight-arrow" aria-hidden>
                →
              </span>
            </Link>
            <Link to="/admin/waitlist" className="admin-insight-link">
              <span className="admin-insight-copy">
                <strong>Waitlist</strong>
                <span>Landing page sign-ups by day, group, source, and college or company.</span>
              </span>
              <span className="admin-insight-arrow" aria-hidden>
                →
              </span>
            </Link>
          </section>

          <section className="profile-panel" aria-labelledby="admin-registration-heading">
            <h2 id="admin-registration-heading" className="profile-panel-title">
              Registration
            </h2>
            <div className="profile-setting-row">
              <div className="profile-setting-copy">
                <h3>Allow open registration</h3>
                <p>
                  When on, new signups become active immediately as Learners. When off, they wait
                  in the approval queue where you pick a role.
                </p>
              </div>
              <button
                type="button"
                className="profile-switch"
                role="switch"
                aria-checked={registrationOpen}
                aria-label="Allow open registration"
                disabled={settingsLoading || settingsSaving}
                onClick={() => void onToggleRegistration()}
              >
                <span>{registrationOpen ? 'On' : 'Off'}</span>
              </button>
            </div>
            {settingsLoading ? <p className="profile-setting-status">Loading…</p> : null}
            {settingsError ? (
              <p className="profile-setting-status profile-setting-status--error">{settingsError}</p>
            ) : null}
          </section>

          <section className="profile-panel" aria-labelledby="admin-pending-heading">
            <h2 id="admin-pending-heading" className="profile-panel-title">
              Pending approvals
            </h2>
            {usersLoading ? <p className="profile-setting-status">Loading…</p> : null}
            {usersError ? (
              <p className="profile-setting-status profile-setting-status--error">{usersError}</p>
            ) : null}
            {!usersLoading && pending.length === 0 ? (
              <p className="profile-setting-status">No pending signups.</p>
            ) : null}
            {pending.length > 0 ? (
              <ul className="admin-user-list">{pending.map((u) => renderUserRow(u, 'pending'))}</ul>
            ) : null}
          </section>

          <section className="profile-panel" aria-labelledby="admin-active-heading">
            <h2 id="admin-active-heading" className="profile-panel-title">
              Active users
            </h2>
            <p className="profile-setting-status admin-section-lead">
              Change roles anytime. Reviewers must have at least one track.
            </p>
            {!usersLoading && active.length === 0 ? (
              <p className="profile-setting-status">No active users.</p>
            ) : null}
            {active.length > 0 ? (
              <ul className="admin-user-list">{active.map((u) => renderUserRow(u, 'active'))}</ul>
            ) : null}
          </section>

          <section className="profile-panel" aria-labelledby="admin-spark-heading">
            <h2 id="admin-spark-heading" className="profile-panel-title">
              Spark settings
            </h2>
            <div className="profile-setting-row">
              <div className="profile-setting-copy">
                <h3>Spark job watcher</h3>
                <p>
                  When on, the cluster kills jobs that exceed the lab hard time limit. Turn off
                  while testing long runs.
                </p>
              </div>
              <button
                type="button"
                className="profile-switch"
                role="switch"
                aria-checked={watcherEnabled}
                aria-label="Spark job watcher"
                disabled={settingsLoading || settingsSaving}
                onClick={() => void onToggleWatcher()}
              >
                <span>{watcherEnabled ? 'On' : 'Off'}</span>
              </button>
            </div>
            {!settingsLoading && !clusterSynced && !settingsError ? (
              <p className="profile-setting-status">Cluster did not confirm the last change.</p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
