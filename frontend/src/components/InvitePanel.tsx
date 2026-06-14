import React, { useEffect, useState } from 'react';
import { createInvite, fetchInvites } from '../services/authApi';
import type { ChallengePublic, InviteRecord } from '../types/domain';

interface InvitePanelProps {
  challenges: ChallengePublic[];
}

export default function InvitePanel({ challenges }: InvitePanelProps): JSX.Element {
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [selectedChallenge, setSelectedChallenge] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    try {
      const list = await fetchInvites() as InviteRecord[];
      setInvites(list);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error || err.message || 'Unknown error');
    }
  };

  useEffect(() => {
    reload();
    if (challenges && challenges.length > 0) {
      const first = challenges.find((c) => c.finalized) || challenges[0];
      setSelectedChallenge(first?.id || '');
    }
  }, [challenges]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await createInvite({ challengeId: selectedChallenge || undefined });
      await reload();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error || err.message || 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (token: string): Promise<void> => {
    const url = `${window.location.origin}/?candidate=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch (_e) {
      setError('Clipboard copy failed; please copy the URL manually.');
    }
  };

  return (
    <div>
      <h3>Candidate Invites</h3>
      <div className="invite-controls">
        <select value={selectedChallenge} onChange={(e) => setSelectedChallenge(e.target.value)}>
          <option value="">Any challenge</option>
          {(challenges || []).map((c) => (
            <option key={c.id} value={c.id} disabled={!c.finalized}>
              {c.title}
              {c.finalized ? '' : ' (coming soon)'}
            </option>
          ))}
        </select>
        <button disabled={busy} onClick={handleCreate}>
          {busy ? 'Creating…' : 'Create invite'}
        </button>
      </div>
      {error && <div className="alert" style={{ marginBottom: 10 }}>{error}</div>}
      <table className="invites-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Challenge</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Link</th>
          </tr>
        </thead>
        <tbody>
          {invites.map((inv) => (
            <tr key={inv.token}>
              <td style={{ color: 'var(--text)' }}>{inv.name}</td>
              <td>{inv.challengeId || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
              <td>
                {inv.used
                  ? <span className="badge">used</span>
                  : <span className="badge brand"><span className="dot" /> ready</span>}
              </td>
              <td style={{ textAlign: 'right' }}>
                <span className="copy-link" onClick={() => handleCopy(inv.token)}>
                  {copied === inv.token ? 'copied ✓' : 'copy link'}
                </span>
              </td>
            </tr>
          ))}
          {invites.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px 0' }}>
                No invites yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
