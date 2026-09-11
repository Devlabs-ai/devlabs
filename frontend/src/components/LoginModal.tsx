import React, { useEffect, useRef, useState } from 'react';
import { loginWithEmail } from '../services/authApi';
import type { UserRecord } from '../types/domain';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onLoggedIn: (user: UserRecord) => void;
  initialError?: string | null;
}

/** Dev sign-in: enter any email → continue (no OTP / company check). */
export default function LoginModal({
  open,
  onClose,
  onLoggedIn,
  initialError = null,
}: LoginModalProps): JSX.Element | null {
  const [email, setEmail] = useState<string>('');
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState<boolean>(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError(initialError);
      setTimeout(() => emailRef.current?.focus(), 60);
    }
  }, [open, initialError]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const handleSubmit = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault();
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    if (!email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const data = await loginWithEmail(email.trim());
      onLoggedIn(data.user);
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: string } }; message?: string };
      setError(ex?.response?.data?.error || ex.message || 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="login-modal-overlay"
      role="presentation"
      onClick={() => !busy && onClose()}
    >
      <div
        className="login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
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
            <h1 id="login-modal-title">Sign in to Devlabs</h1>
            <p className="login-card-sub">
              Enter any email to continue — used only to identify you while we build the platform.
            </p>
          </header>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="login-fields">
              <label className="login-field">
                <span className="login-field-label">Email</span>
                <input
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                />
              </label>
            </div>

            {error && <div className="alert login-alert">{error}</div>}

            <div className="login-actions">
              <button className="login-submit" disabled={busy} type="submit">
                {busy ? 'Signing in…' : 'Continue'}
              </button>
            </div>

            <footer className="login-card-foot otp-foot">
              <span>Dev login — enter any email to continue</span>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );
}
