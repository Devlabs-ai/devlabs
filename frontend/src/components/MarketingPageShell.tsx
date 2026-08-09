import React, { createContext, useContext, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandMark from './BrandMark';
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
}

export default function MarketingPageShell({ children, onLoggedIn }: MarketingPageShellProps): JSX.Element {
  const [loginOpen, setLoginOpen] = useState<boolean>(false);
  const [salesOpen, setSalesOpen] = useState<boolean>(false);

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
            <BrandMark className="brand-mark" />
            DevLabs
            <span className="landing-brand-ver">v0.2</span>
          </Link>
        </header>

        <main className="landing-main">{children}</main>

        <footer className="landing-footer">
          <span>DevLabs v0.2</span>
          <span className="landing-footer-sep">·</span>
          <span>Hands-on labs for modern engineering</span>
        </footer>

        <LoginModal
          open={loginOpen}
          onClose={() => setLoginOpen(false)}
          onLoggedIn={onLoggedIn}
        />

        <ContactSalesModal
          open={salesOpen}
          onClose={() => setSalesOpen(false)}
        />
      </div>
    </MarketingContext.Provider>
  );
}
