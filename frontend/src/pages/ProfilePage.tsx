import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isAdminUser } from '../services/authApi';
import { IconCoins } from '../components/ChromeIcons';
import SubscriptionsPanel from '../components/SubscriptionsPanel';
import Avatar, { AvatarPicker } from '../components/Avatar';
import ActivityHeatmap, { type ActivityDay } from '../components/ActivityHeatmap';
import { fetchMyProfile, saveAvatar } from '../services/profileApi';

export type ProfileSection = 'overview' | 'subscriptions' | 'contact' | 'preferences' | 'privacy';

const NAV_ITEMS: { id: ProfileSection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'contact', label: 'Contact' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'privacy', label: 'Privacy' },
];

export default function ProfilePage(): JSX.Element {
  const { currentUser, challenges, onLogout } = useAppState();
  const isAdmin = Boolean(currentUser?.admin) || isAdminUser(currentUser);
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('section');
  const section: ProfileSection = NAV_ITEMS.some((item) => item.id === requested)
    ? (requested as ProfileSection)
    : 'overview';
  const setSection = (next: ProfileSection): void => {
    setSearchParams(next === 'overview' ? {} : { section: next }, { replace: true });
  };
  const [contactSubject, setContactSubject] = useState('General question');
  const [contactMessage, setContactMessage] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityDay[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const displayName = currentUser?.name || currentUser?.email || 'You';

  useEffect(() => {
    let cancelled = false;
    fetchMyProfile()
      .then((p) => {
        if (cancelled) return;
        setAvatar(p.avatar);
        setActivity(p.activity);
      })
      .catch(() => { if (!cancelled) setActivity([]); });
    return () => { cancelled = true; };
  }, [currentUser?.email]);

  const onSelectAvatar = (next: string | null): void => {
    const previous = avatar;
    setAvatar(next);
    setAvatarError(null);
    setSavingAvatar(true);
    saveAvatar(next)
      .catch(() => {
        setAvatar(previous);
        setAvatarError('Could not save your picture. Try again.');
      })
      .finally(() => setSavingAvatar(false));
  };

  const finalizedCount = useMemo(
    () => challenges.filter((c) => c.finalized).length,
    [challenges],
  );
  const solvedCount = useMemo(
    () => challenges.filter((c) => c.solved && c.finalized).length,
    [challenges],
  );
  const tokenCount = useMemo(
    () =>
      challenges
        .filter((c) => c.solved && c.finalized)
        .reduce(
          (sum, c) =>
            sum +
            (typeof c.earnedTokens === 'number'
              ? c.earnedTokens
              : typeof c.tokens === 'number'
                ? c.tokens
                : 10),
          0,
        ),
    [challenges],
  );

  const contactMailto = useMemo(() => {
    const subject = encodeURIComponent(`[DevSetu] ${contactSubject}`);
    const body = encodeURIComponent(
      [
        contactMessage.trim() || '(Write your message here.)',
        '',
        `— ${currentUser?.email || 'signed-in user'}`,
      ].join('\n'),
    );
    return `mailto:hello@devsetu.ai?subject=${subject}&body=${body}`;
  }, [contactMessage, contactSubject, currentUser?.email]);

  return (
    <div className="app-page profile-page">
      <header className="profile-hero profile-hero--avatar">
        <Avatar avatar={avatar} name={displayName} size={72} className="profile-avatar" />
        <div className="profile-hero-copy">
          <h1 className="profile-title">Profile</h1>
          <p className="profile-lead">
            {currentUser?.email ? `Signed in as ${currentUser.email}` : 'Your account.'}
          </p>
          <button
            type="button"
            className="profile-avatar-change"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
          >
            {pickerOpen ? 'Done' : 'Change picture'}
          </button>
        </div>
      </header>

      {pickerOpen && (
        <section className="profile-panel profile-avatar-panel" aria-label="Choose a profile picture">
          <AvatarPicker value={avatar} name={displayName} disabled={savingAvatar} onSelect={onSelectAvatar} />
          {avatarError && <p className="profile-avatar-error">{avatarError}</p>}
        </section>
      )}

      <div className="profile-body">
        <nav className="profile-nav" aria-label="Profile sections">
          <ul className="profile-nav-list">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`profile-nav-item${section === item.id ? ' is-active' : ''}`}
                  aria-current={section === item.id ? 'page' : undefined}
                  onClick={() => setSection(item.id)}
                >
                  {item.label}
                </button>
              </li>
            ))}
            {isAdmin ? (
              <li>
                <Link to="/admin" className="profile-nav-item">
                  Admin
                </Link>
              </li>
            ) : null}
          </ul>


          <button
            type="button"
            className="profile-nav-item profile-nav-item--signout profile-nav-signout-desktop"
            onClick={onLogout}
          >
            Sign out
          </button>
        </nav>

        <div className="profile-stack">
          {section === 'overview' ? (
            <section className="profile-panel" aria-labelledby="profile-account-heading">
              <h2 id="profile-account-heading" className="profile-panel-title">
                Account
              </h2>
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
          ) : null}

          {section === 'overview' ? (
            <section className="profile-panel" aria-labelledby="profile-activity-heading">
              <h2 id="profile-activity-heading" className="profile-panel-title">
                Activity
              </h2>
              {activity ? (
                <ActivityHeatmap activity={activity} />
              ) : (
                <p className="profile-panel-copy"><span className="spinner" /> Loading…</p>
              )}
            </section>
          ) : null}

          {section === 'subscriptions' ? <SubscriptionsPanel /> : null}

          {section === 'contact' ? (
            <section className="profile-panel" aria-labelledby="profile-contact-heading">
              <h2 id="profile-contact-heading" className="profile-panel-title">
                Contact
              </h2>
              <p className="profile-panel-copy">
                Questions about labs, teams, or campuses — send a note and we&apos;ll get back to you.
              </p>
              <form
                className="profile-contact-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  window.location.href = contactMailto;
                }}
              >
                <label className="profile-field">
                  <span>Subject</span>
                  <select
                    value={contactSubject}
                    onChange={(e) => setContactSubject(e.target.value)}
                  >
                    <option>General question</option>
                    <option>Billing &amp; plans</option>
                    <option>Bug report</option>
                    <option>Team / campus</option>
                  </select>
                </label>
                <label className="profile-field">
                  <span>Message</span>
                  <textarea
                    rows={5}
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                    placeholder="How can we help?"
                  />
                </label>
                <button type="submit" className="profile-contact-submit">
                  Open email
                </button>
              </form>
            </section>
          ) : null}

          {section === 'preferences' ? (
            <section className="profile-panel" aria-labelledby="profile-prefs-heading">
              <h2 id="profile-prefs-heading" className="profile-panel-title">
                Preferences
              </h2>
              <p className="profile-panel-copy">
                Lab defaults and notification preferences will land here. For now, sessions use your
                account email and the track you open from Play.
              </p>
            </section>
          ) : null}

          {section === 'privacy' ? (
            <section className="profile-panel" aria-labelledby="profile-privacy-heading">
              <h2 id="profile-privacy-heading" className="profile-panel-title">
                Privacy
              </h2>
              <p className="profile-panel-copy">
                We store your account email, lab progress, and session activity to run the practice
                floor. Export and delete controls will appear here as the account tools expand.
              </p>
            </section>
          ) : null}
        </div>

        {section === 'overview' ? (
          <aside className="profile-side" aria-label="Collections">
            <section className="profile-shelf profile-shelf--progress" aria-labelledby="profile-progress-heading">
              <h2 id="profile-progress-heading" className="profile-shelf-title">
                Your progress
              </h2>
              <div className="profile-progress-hero">
                <strong>{solvedCount}</strong>
                <span>/{Math.max(finalizedCount, 1)}</span>
                <em>solved</em>
              </div>
            </section>

            <section className="profile-shelf" aria-labelledby="profile-tokens-heading">
              <div className="profile-shelf-icon" aria-hidden="true">
                <IconCoins />
              </div>
              <div className="profile-shelf-copy">
                <h2 id="profile-tokens-heading" className="profile-shelf-title">
                  Tokens
                </h2>
                <p className="profile-shelf-lead">Earned from solved labs</p>
              </div>
              <p className="profile-shelf-count" aria-label={`${tokenCount} tokens`}>
                {tokenCount}
              </p>
            </section>
          </aside>
        ) : (
          <div className="profile-side profile-side--spacer" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
