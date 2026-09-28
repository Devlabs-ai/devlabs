import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import { acceptAuthSession } from '../services/authApi';
import type { UserRecord } from '../types/domain';

interface GoogleAuthCallbackPageProps {
  onLoggedIn: (user: UserRecord) => void;
}

/** Landing after Google OAuth redirect (?token=&user= / ?pending= / ?error=). */
export default function GoogleAuthCallbackPage({
  onLoggedIn,
}: GoogleAuthCallbackPageProps): JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string>('Finishing Google sign-in…');
  const [tone, setTone] = useState<'pending' | 'error' | 'ok'>('ok');

  useEffect(() => {
    const error = searchParams.get('error');
    const pending = searchParams.get('pending');
    const pendingMessage = searchParams.get('message');
    const token = searchParams.get('token');
    const userRaw = searchParams.get('user');

    if (error) {
      setTone('error');
      setMessage(error);
      const t = window.setTimeout(() => navigate('/', { replace: true }), 2800);
      return () => window.clearTimeout(t);
    }

    if (pending === '1') {
      setTone('pending');
      setMessage(pendingMessage || 'Account created. Awaiting admin approval.');
      const t = window.setTimeout(() => navigate('/', { replace: true }), 3200);
      return () => window.clearTimeout(t);
    }

    if (!token || !userRaw) {
      setTone('error');
      setMessage('Missing sign-in details. Returning home…');
      const t = window.setTimeout(() => navigate('/', { replace: true }), 2000);
      return () => window.clearTimeout(t);
    }

    try {
      const user = JSON.parse(userRaw) as UserRecord;
      acceptAuthSession(token, user);
      onLoggedIn(user);
    } catch {
      setTone('error');
      setMessage('Could not complete Google sign-in.');
      const t = window.setTimeout(() => navigate('/', { replace: true }), 2500);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [searchParams, navigate, onLoggedIn]);

  return (
    <div className="login login-oauth-callback">
      <div className="login-card login-modal-card--oauth">
        <div className="login-oauth-brand" aria-hidden>
          <BrandMark className="brand-mark login-oauth-mark" title="" />
        </div>
        <p className={`login-oauth-callback-msg login-oauth-callback-msg--${tone}`}>
          {message}
        </p>
      </div>
    </div>
  );
}
