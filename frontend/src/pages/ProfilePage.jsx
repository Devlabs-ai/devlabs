import React, { useEffect, useState } from 'react';
import AppPageHeader from '../components/AppPageHeader.jsx';
import { useAppState } from '../context/AppStateContext.jsx';
import { fetchInvites } from '../services/authApi.js';

function inviteUrl(token) {
  return `${window.location.origin}/?candidate=${token}`;
}

export default function ProfilePage() {
  const { currentUser } = useAppState();
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await fetchInvites();
        if (!cancelled) setInvites(list);
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.error || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleCopy = async (token) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch (_e) {
      setError('Clipboard copy failed');
    }
  };

  return (
    <div className="app-page profile-page">
      <AppPageHeader
        eyebrow="Account"
        title="Profile"
        lead={currentUser?.email ? `Signed in as ${currentUser.email}` : 'Your account and interview invites.'}
      />

      <section className="profile-evals-section">
        <h2 className="profile-section-title">Evals</h2>
        <p className="profile-section-lead">
          Candidate links you generated from My Challenges.
        </p>

        {error && <div className="alert app-page-alert">{error}</div>}

        {loading ? (
          <div className="profile-evals-loading">Loading evals…</div>
        ) : (
          <table className="invites-table profile-evals-table">
            <thead>
              <tr>
                <th>Challenge</th>
                <th>Conducted by</th>
                <th>Candidate</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Link</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.token}>
                  <td>{inv.challengeTitle || inv.challengeId || '—'}</td>
                  <td>{inv.conductedByName || currentUser?.name || '—'}</td>
                  <td>
                    <div className="profile-candidate-cell">
                      <span>{inv.name}</span>
                      {inv.candidateEmail && (
                        <span className="profile-candidate-email">{inv.candidateEmail}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    {inv.used
                      ? <span className="badge">used</span>
                      : inv.expired
                        ? <span className="badge">expired</span>
                        : <span className="badge brand"><span className="dot" /> ready</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {!inv.used && !inv.expired ? (
                      <span className="copy-link" onClick={() => handleCopy(inv.token)}>
                        {copied === inv.token ? 'copied ✓' : 'copy link'}
                      </span>
                    ) : (
                      <span className="profile-link-disabled">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {invites.length === 0 && (
                <tr>
                  <td colSpan={5} className="profile-evals-empty">
                    No evals yet. Share a challenge from My Challenges to create a candidate link.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
