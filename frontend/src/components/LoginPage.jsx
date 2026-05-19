import React, { useState } from 'react';
import { login } from '../services/authApi.js';

export default function LoginPage({ onLoggedIn }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
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
        <div className="hint">Default: admin / admin123</div>
      </form>
    </div>
  );
}
