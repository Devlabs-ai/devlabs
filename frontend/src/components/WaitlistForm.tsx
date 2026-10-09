import React, { useState } from 'react';
import { joinWaitlist, type WaitlistRole } from '../services/waitlistApi';
import { LAUNCH_OFFER } from '../constants/pricing';

const ROLE_OPTIONS: ReadonlyArray<{ id: WaitlistRole; label: string }> = [
  { id: 'student', label: 'Student' },
  { id: 'developer', label: 'Developer' },
];

function sourceFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  return params.get('ref') || params.get('utm_source') || undefined;
}

export default function WaitlistForm(): JSX.Element {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WaitlistRole>('student');
  const [organization, setOrganization] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await joinWaitlist({
        email: email.trim(),
        role,
        organization: organization.trim() || undefined,
        source: sourceFromUrl(),
        website,
      });
      setDone(true);
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: string } }; message?: string };
      setError(ex.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="waitlist-done" role="status">
        <strong>You&rsquo;re on the list.</strong>
        <span>
          We&rsquo;ll email you before launch with your {LAUNCH_OFFER.percentOff}% off launch offer.
        </span>
      </div>
    );
  }

  const orgLabel = role === 'developer' ? 'Company (optional)' : 'College (optional)';

  return (
    <form className="waitlist-form" onSubmit={(e) => void onSubmit(e)}>
      <div className="waitlist-roles" role="radiogroup" aria-label="I am a">
        {ROLE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={role === opt.id}
            className={`waitlist-role${role === opt.id ? ' is-active' : ''}`}
            onClick={() => setRole(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <input
        className="waitlist-input"
        type="email"
        required
        autoComplete="email"
        placeholder="Your email"
        aria-label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="waitlist-input"
        type="text"
        maxLength={120}
        placeholder={orgLabel}
        aria-label={orgLabel}
        value={organization}
        onChange={(e) => setOrganization(e.target.value)}
      />
      <input
        className="waitlist-honeypot"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
      <button type="submit" className="landing-cta-primary waitlist-submit" disabled={busy}>
        {busy ? 'Joining…' : 'Join the waitlist'}
        <span className="landing-cta-arrow" aria-hidden>
          →
        </span>
      </button>
      {error ? <p className="waitlist-error">{error}</p> : null}
    </form>
  );
}
