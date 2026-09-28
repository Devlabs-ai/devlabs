import React, { useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isAdminUser } from '../services/authApi';
import { IconCoins } from '../components/ChromeIcons';

type ProfileSection = 'overview' | 'subscriptions' | 'contact' | 'preferences' | 'privacy';

const NAV_ITEMS: { id: ProfileSection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'contact', label: 'Contact' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'privacy', label: 'Privacy' },
];

export default function ProfilePage(): JSX.Element {
  const { currentUser, challenges, onLogout } = useAppState();
  const navigate = useNavigate();
  const isAdmin = Boolean(currentUser?.admin) || isAdminUser(currentUser);
  const sectionSelectId = useId();
  const [section, setSection] = useState<ProfileSection>('overview');
  const [contactSubject, setContactSubject] = useState('General question');
  const [contactMessage, setContactMessage] = useState('');

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

  const onMobileNavChange = (value: string): void => {
    if (value === 'admin') {
      navigate('/admin');
      return;
    }
    if (value === 'signout') {
      onLogout();
      return;
    }
    setSection(value as ProfileSection);
  };

  return (
    <div className="app-page profile-page">
      <header className="profile-hero">
        <h1 className="profile-title">Profile</h1>
        <p className="profile-lead">
          {currentUser?.email ? `Signed in as ${currentUser.email}` : 'Your account.'}
        </p>
      </header>

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

          <div className="profile-nav-mobile">
            <label className="profile-nav-select-label" htmlFor={sectionSelectId}>
              Section
            </label>
            <select
              id={sectionSelectId}
              className="profile-nav-select"
              value={section}
              onChange={(e) => onMobileNavChange(e.target.value)}
            >
              {NAV_ITEMS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
              {isAdmin ? <option value="admin">Admin</option> : null}
              <option value="signout">Sign out</option>
            </select>
          </div>

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

          {section === 'subscriptions' ? (
            <section className="profile-panel" aria-labelledby="profile-subs-heading">
              <h2 id="profile-subs-heading" className="profile-panel-title">
                Subscriptions
              </h2>
              <div className="profile-plan-card">
                <p className="profile-plan-badge">Current plan</p>
                <h3 className="profile-plan-name">Beta access</h3>
                <p className="profile-plan-price">Free</p>
                <p className="profile-panel-copy">
                  You&apos;re on open beta — full practice floor while we grow. Paid plans will appear here
                  when billing opens.
                </p>
                <Link to="/" className="profile-panel-link">
                  View pricing on the home page
                </Link>
              </div>
            </section>
          ) : null}

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
