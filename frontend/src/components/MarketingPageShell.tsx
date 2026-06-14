import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LoginModal from './LoginModal';
import ContactSalesModal from './ContactSalesModal';
import type { UserRecord } from '../types/domain';

interface MarketingContextValue {
  openLogin: () => void;
  openSales: () => void;
}

const MarketingContext = createContext<MarketingContextValue | null>(null);

export function useMarketing(): MarketingContextValue {
  const ctx = useContext(MarketingContext);
  if (!ctx) throw new Error('useMarketing must be used within MarketingPageShell');
  return ctx;
}

interface MarketingPageShellProps {
  children: React.ReactNode;
  onLoggedIn: (user: UserRecord) => void;
  candidateError?: string | null;
}

export default function MarketingPageShell({ children, onLoggedIn, candidateError }: MarketingPageShellProps): JSX.Element {
  const [loginOpen, setLoginOpen] = useState<boolean>(false);
  const [salesOpen, setSalesOpen] = useState<boolean>(false);

  useEffect(() => {
    if (candidateError) setLoginOpen(true);
  }, [candidateError]);

  const inviteError = candidateError ? `Candidate invite error: ${candidateError}` : null;
  const modalOpen = loginOpen || salesOpen;

  const value = useMemo<MarketingContextValue>(() => ({
    openLogin: (): void => {
      setSalesOpen(false);
      setLoginOpen(true);
    },
    openSales: (): void => {
      setLoginOpen(false);
      setSalesOpen(true);
    },
  }), []);

  return (
    <MarketingContext.Provider value={value}>
      <div className={`landing ${modalOpen ? 'landing-modal-open' : ''}`}>
        <header className="landing-header">
          <Link to="/" className="landing-brand">
            <span className="logo-dot" />
            Devlabs
          </Link>
          <nav className="landing-nav" aria-label="Marketing">
            <Link to="/about">About</Link>
            <Link to="/pricing">Pricing</Link>
          </nav>
        </header>

        <main className="landing-main">{children}</main>

        <footer className="landing-footer">
          <span>Devlabs v0.1</span>
          <span className="landing-footer-sep">·</span>
          <Link to="/about">About</Link>
          <span className="landing-footer-sep">·</span>
          <Link to="/pricing">Pricing</Link>
          <span className="landing-footer-sep">·</span>
          <span>Interview platform for infrastructure debugging</span>
        </footer>

        <LoginModal
          open={loginOpen}
          onClose={() => setLoginOpen(false)}
          onLoggedIn={onLoggedIn}
          initialError={inviteError}
        />

        <ContactSalesModal
          open={salesOpen}
          onClose={() => setSalesOpen(false)}
        />
      </div>
    </MarketingContext.Provider>
  );
}
