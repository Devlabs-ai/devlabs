import React, { useEffect, useRef, useState } from 'react';
import { createInvite } from '../services/authApi';
import type { ChallengePublic, InviteRecord } from '../types/domain';

interface ShareEvalModalProps {
  open: boolean;
  challenge: ChallengePublic | null;
  onClose: () => void;
}

function inviteUrl(token: string): string {
  return `${window.location.origin}/?candidate=${token}`;
}

export default function ShareEvalModal({ open, challenge, onClose }: ShareEvalModalProps): JSX.Element | null {
  const [candidateName, setCandidateName] = useState<string>('');
  const [candidateEmail, setCandidateEmail] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [generated, setGenerated] = useState<InviteRecord | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCandidateName('');
      setCandidateEmail('');
      setError(null);
      setGenerated(null);
      setCopied(false);
    }
  }, [open, challenge?.id]);

  useEffect(() => {
    if (!open || generated) return undefined;
    const t = setTimeout(() => nameRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open, generated]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!challenge?.id) return;
    setBusy(true);
    setError(null);
    try {
      const invite = await createInvite({
        challengeId: challenge.id,
        name: candidateName.trim(),
        email: candidateEmail.trim(),
      }) as InviteRecord;
      setGenerated(invite);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error || e.message || 'Failed to generate link');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!generated?.token) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(generated.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_e) {
      setError('Clipboard copy failed; copy the URL manually.');
    }
  };

  if (!open || !challenge) return null;

  return (
    <div
      className="login-modal-overlay"
      role="presentation"
      onClick={() => !busy && onClose()}
    >
      <div
        className="login-modal share-eval-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-eval-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="ghost login-modal-close"
          aria-label="Close"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>

        <div className="login-card login-modal-card">
          <header className="login-card-head">
            <h1 id="share-eval-title">Share challenge</h1>
            <p className="login-card-sub">
              Generate a one-time link for <strong>{challenge.title}</strong>.
            </p>
          </header>

          {generated ? (
            <div className="share-eval-success">
              <p className="share-eval-success-label">
                Candidate link ready — expires in 24 hours.
              </p>
              <div className="share-eval-url-row">
                <input
                  type="text"
                  className="share-eval-url-input"
                  readOnly
                  value={inviteUrl(generated.token)}
                />
                <button type="button" className="login-submit" onClick={handleCopy}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button type="button" className="login-submit login-submit--secondary" onClick={onClose}>
                Done
              </button>
            </div>
          ) : (
            <form className="login-form" onSubmit={handleSubmit}>
              <label className="login-field">
                <span>Candidate name</span>
                <input
                  ref={nameRef}
                  type="text"
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  placeholder="Jane Doe"
                  required
                  disabled={busy}
                />
              </label>
              <label className="login-field">
                <span>Candidate email</span>
                <input
                  type="email"
                  value={candidateEmail}
                  onChange={(e) => setCandidateEmail(e.target.value)}
                  placeholder="jane@company.com"
                  required
                  disabled={busy}
                />
              </label>
              {error && <div className="alert">{error}</div>}
              <button type="submit" className="login-submit" disabled={busy}>
                {busy ? 'Generating…' : 'Generate link'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
