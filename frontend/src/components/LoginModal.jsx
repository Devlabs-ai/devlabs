import React, { useEffect, useRef, useState } from 'react';
import { requestOtp, verifyOtp } from '../services/authApi.js';

// Two-step OTP login:
//   step 'email'  — user enters their company email address
//   step 'code'   — user enters the 6-digit code sent to that email

export default function LoginModal({ open, onClose, onLoggedIn, initialError = null }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(initialError);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const codeRef = useRef(null);
  const emailRef = useRef(null);

  // Reset to initial state whenever the modal opens/closes
  useEffect(() => {
    if (open) {
      setStep('email');
      setCode('');
      setError(initialError);
      setInfo(null);
      setCountdown(0);
    }
  }, [open, initialError]);

  // Focus the relevant input when the step changes
  useEffect(() => {
    if (!open) return;
    if (step === 'code') setTimeout(() => codeRef.current?.focus(), 60);
    else setTimeout(() => emailRef.current?.focus(), 60);
  }, [open, step]);

  // Countdown timer for resend throttle
  useEffect(() => {
    if (countdown <= 0) return undefined;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Keyboard close
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const handleRequestOtp = async (e) => {
    e?.preventDefault();
    if (!email.trim()) return setError('Enter your company email address.');
    if (!email.includes('@')) return setError('Enter a valid email address.');
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await requestOtp(email.trim());
      setStep('code');
              setInfo(`A ${CODE_LENGTH}-digit code was sent to ${email.trim()}`);
      setCountdown(30);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    if (!code.trim()) return setError('Enter the 6-digit code.');
    setError(null);
    setBusy(true);
    try {
      const data = await verifyOtp(email.trim(), code.trim());
      onLoggedIn && onLoggedIn(data.user);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleResend = () => {
    if (countdown > 0 || busy) return;
    setCode('');
    setError(null);
    handleRequestOtp();
  };

  const CODE_LENGTH = parseInt(import.meta.env.VITE_OTP_LENGTH || '6', 10);

  const handleCodeChange = (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(v);
    if (v.length === CODE_LENGTH) {
      setTimeout(() => handleVerifyOtp(), 80);
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
            <h1 id="login-modal-title">
              {step === 'email' ? 'Sign in to Devlabs' : 'Check your email'}
            </h1>
            <p className="login-card-sub">
              {step === 'email'
                ? 'Enter your company email — we\'ll send you a one-time code.'
                : `We sent a ${CODE_LENGTH}-digit code to ${email}. Enter it below.`}
            </p>
          </header>

          {step === 'email' ? (
            <form className="login-form" onSubmit={handleRequestOtp}>
              <div className="login-fields">
                <label className="login-field">
                  <span className="login-field-label">Work email</span>
                  <input
                    ref={emailRef}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@yourcompany.com"
                    autoComplete="email"
                    autoFocus
                  />
                </label>
              </div>

              {error && <div className="alert login-alert">{error}</div>}

              <div className="login-actions">
                <button className="login-submit" disabled={busy} type="submit">
                  {busy ? 'Sending code…' : 'Send code'}
                </button>
              </div>

              <footer className="login-card-foot otp-foot">
                <span>Candidates join via invite link — no sign-in needed</span>
              </footer>
            </form>
          ) : (
            <form className="login-form" onSubmit={handleVerifyOtp}>
              {info && <div className="otp-info">{info}</div>}

              <div className="otp-code-field">
                <input
                  ref={codeRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={code}
                  onChange={handleCodeChange}
                  placeholder="000000"
                  maxLength={CODE_LENGTH}
                  autoComplete="one-time-code"
                  className="otp-code-input"
                />
              </div>

              {error && <div className="alert login-alert">{error}</div>}

              <div className="login-actions">
                <button className="login-submit" disabled={busy || code.length < CODE_LENGTH} type="submit">
                  {busy ? 'Verifying…' : 'Verify & sign in'}
                </button>
              </div>

              <div className="otp-resend-row">
                <button
                  type="button"
                  className="ghost otp-resend-btn"
                  disabled={busy || countdown > 0}
                  onClick={handleResend}
                >
                  {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
                </button>
                <span className="otp-resend-sep">·</span>
                <button
                  type="button"
                  className="ghost otp-back-btn"
                  disabled={busy}
                  onClick={() => { setStep('email'); setCode(''); setError(null); setInfo(null); }}
                >
                  Change email
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
