import React, { useEffect, useState } from 'react';
import { login } from '../services/authApi.js';

export default function LoginModal({ open, onClose, onLoggedIn, initialError = null }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setError(initialError);
  }, [open, initialError]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const doLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      onLoggedIn && onLoggedIn();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await doLogin();
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
            <h1 id="login-modal-title">Welcome back</h1>
            <p className="login-card-sub">
              Sign in as an interviewer to author challenges and run sessions.
            </p>
          </header>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="login-fields">
              <label className="login-field">
                <span className="login-field-label">Username</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                />
              </label>
              <label className="login-field">
                <span className="login-field-label">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
            </div>

            {error && <div className="alert login-alert">{error}</div>}

            <div className="login-actions">
              <button className="login-submit" disabled={busy} type="submit">
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>

          <footer className="login-card-foot">
            <span className="login-demo-pill">Demo</span>
            <span className="login-demo-creds">admin / admin123</span>
            <span className="login-foot-sep">·</span>
            <span>Specialists handbook &amp; build lessons</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
