import React, { createContext, useContext, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandMark from './BrandMark';
import LoginModal from './LoginModal';
import type { UserRecord } from '../types/domain';

interface MarketingContextValue {
  openLogin: () => void;
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
}

export default function MarketingPageShell({ children, onLoggedIn }: MarketingPageShellProps): JSX.Element {
  const [loginOpen, setLoginOpen] = useState<boolean>(false);

  const value = useMemo<MarketingContextValue>(() => ({
    openLogin: (): void => {
      setLoginOpen(true);
    },
  }), []);

  return (
    <MarketingContext.Provider value={value}>
      <div className={`landing ${loginOpen ? 'landing-modal-open' : ''}`}>
        <header className="landing-brand-header">
          <Link to="/" className="landing-brand-header-mark" aria-label="DevSetu home">
            <BrandMark className="brand-mark" title="" />
            <span className="landing-brand-header-name">DevSetu</span>
          </Link>
        </header>

        <main className="landing-main">{children}</main>

        <footer className="landing-footer">
          <span>DevSetu</span>
          <span className="landing-footer-sep">·</span>
          <span>The bridge to become a versatile engineer</span>
        </footer>

        <LoginModal
          open={loginOpen}
          onClose={() => setLoginOpen(false)}
          onLoggedIn={onLoggedIn}
        />
      </div>
    </MarketingContext.Provider>
  );
}
