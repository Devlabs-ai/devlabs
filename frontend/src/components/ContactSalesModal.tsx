import React, { useEffect, useRef, useState } from 'react';
import { submitSalesInquiry } from '../services/contactApi';

interface ContactSalesModalProps {
  open: boolean;
  onClose: () => void;
}

const TEAM_SIZES = [
  { value: '1-10', label: '1–10 interviewers' },
  { value: '11-50', label: '11–50 interviewers' },
  { value: '51-200', label: '51–200 interviewers' },
  { value: '200+', label: '200+ interviewers' },
];

const PLANS = [
  { value: 'starter', label: 'Starter' },
  { value: 'pro', label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'unsure', label: 'Not sure yet' },
];

export default function ContactSalesModal({ open, onClose }: ContactSalesModalProps): JSX.Element | null {
  const [companyName, setCompanyName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [teamSize, setTeamSize] = useState<string>('');
  const [plan, setPlan] = useState<string>('unsure');
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);

  const companyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCompanyName('');
      setEmail('');
      setTeamSize('');
      setPlan('unsure');
      setMessage('');
      setError(null);
      setSubmitted(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || submitted) return undefined;
    const t = setTimeout(() => companyRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open, submitted]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!companyName.trim()) { setError('Enter your company name.'); return; }
    if (!email.trim() || !email.includes('@')) { setError('Enter a valid work email.'); return; }
    if (!teamSize) { setError('Select your team size.'); return; }

    setError(null);
    setBusy(true);
    try {
      await submitSalesInquiry({
        companyName: companyName.trim(),
        email: email.trim(),
        teamSize,
        plan,
        message: message.trim(),
      });
      setSubmitted(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error || e.message || 'Unknown error');
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
        className="login-modal contact-sales-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-sales-title"
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
            <h1 id="contact-sales-title">
              {submitted ? 'Request received' : 'Contact sales'}
            </h1>
            <p className="login-card-sub">
              {submitted
                ? 'Thanks for your interest. Our team will reach out within one business day.'
                : 'Tell us about your team — we\'ll set up your company and get you onboarded.'}
            </p>
          </header>

          {submitted ? (
            <div className="contact-sales-success">
              <div className="contact-sales-success-icon" aria-hidden>✓</div>
              <button type="button" className="login-submit" onClick={onClose}>
                Back to home
              </button>
            </div>
          ) : (
            <form className="login-form contact-sales-form" onSubmit={handleSubmit}>
              <div className="login-fields">
                <label className="login-field">
                  <span className="login-field-label">Company name</span>
                  <input
                    ref={companyRef}
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Acme Engineering"
                    autoComplete="organization"
                  />
                </label>

                <label className="login-field">
                  <span className="login-field-label">Work email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@yourcompany.com"
                    autoComplete="email"
                  />
                </label>

                <label className="login-field">
                  <span className="login-field-label">Team size</span>
                  <select value={teamSize} onChange={(e) => setTeamSize(e.target.value)}>
                    <option value="">Select team size</option>
                    {TEAM_SIZES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>

                <label className="login-field">
                  <span className="login-field-label">Plan interest</span>
                  <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                    {PLANS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>

                <label className="login-field">
                  <span className="login-field-label">Anything else? (optional)</span>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Hiring volume, timeline, specific use cases…"
                    rows={3}
                    maxLength={2000}
                  />
                </label>
              </div>

              {error && <div className="alert login-alert">{error}</div>}

              <div className="login-actions">
                <button className="login-submit" disabled={busy} type="submit">
                  {busy ? 'Sending…' : 'Send request'}
                </button>
              </div>

              <footer className="login-card-foot otp-foot">
                <span>Already registered? Use &ldquo;Get started&rdquo; to sign in with your email.</span>
              </footer>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
