import React, { useState } from 'react';
import { login } from '../services/authApi.js';

export default function LoginPage({ onLoggedIn }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const doLogin = async (postLoginPage = null) => {
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      if (postLoginPage) {
        try { sessionStorage.setItem('devlabs_post_login_page', postLoginPage); } catch (_e) { /* noop */ }
      }
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

  return (
    <div className="login">
      <form onSubmit={handleSubmit}>
        <h1>
          <span className="logo-dot" />
          Devlabs
        </h1>
        <div className="hint" style={{ textAlign: 'left', marginBottom: 8 }}>
          Sign in as an interviewer to author challenges and run sessions.
        </div>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="alert">{error}</div>}
        <button disabled={busy} type="submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button
          type="button"
          className="ghost"
          style={{ marginTop: 8, width: '100%' }}
          disabled={busy}
          onClick={() => doLogin('memories')}
        >
          Sign in &amp; open Memories
        </button>
        <div className="hint">Default: admin / admin123 · Specialists handbook &amp; build lessons</div>
      </form>
    </div>
  );
}
