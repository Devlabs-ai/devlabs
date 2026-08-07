import React from 'react';
import AppPageHeader from '../components/AppPageHeader';
import { useAppState } from '../context/AppStateContext';

export default function ProfilePage(): JSX.Element {
  const { currentUser } = useAppState();

  return (
    <div className="app-page profile-page">
      <AppPageHeader
        eyebrow="Account"
        title="Profile"
        lead={currentUser?.email ? `Signed in as ${currentUser.email}` : 'Your account.'}
      />

      <section className="profile-evals-section">
        <h2 className="profile-section-title">Account</h2>
        <p className="profile-section-lead">
          Signed-in account used for Play and authoring.
        </p>
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
    </div>
  );
}
