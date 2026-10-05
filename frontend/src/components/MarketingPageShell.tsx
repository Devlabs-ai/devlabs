import React, { createContext, useContext, useMemo } from 'react';
import { Link } from 'react-router-dom';
import BrandMark from './BrandMark';

interface MarketingContextValue {
  openLogin: () => void;
  getStarted: () => void;
}

const MarketingContext = createContext<MarketingContextValue | null>(null);

export function useMarketing(): MarketingContextValue {
  const ctx = useContext(MarketingContext);
  if (!ctx) throw new Error('useMarketing must be used within MarketingPageShell');
  return ctx;
}

interface MarketingPageShellProps {
  children: React.ReactNode;
  onSignIn: () => void;
  onGetStarted: () => void;
}

export default function MarketingPageShell({
  children,
  onSignIn,
  onGetStarted,
}: MarketingPageShellProps): JSX.Element {
  const value = useMemo<MarketingContextValue>(() => ({
    openLogin: onSignIn,
    getStarted: onGetStarted,
  }), [onSignIn, onGetStarted]);

  return (
    <MarketingContext.Provider value={value}>
      <div className="landing">
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
      </div>
    </MarketingContext.Provider>
  );
}
