import React from 'react';
import { Link } from 'react-router-dom';
import BrandMark from './BrandMark';
import { MAJORS_PATH } from '../constants/projects';
import { MINORS_PATH } from '../constants/minors';
import { PRICING_PATH } from '../constants/pricing';
import { MONTHLY_PAPER_PATH } from '../constants/monthlyPaper';
import { LEADERBOARD_PATH } from '../constants/leaderboard';

const CONTACT_EMAIL = 'admin@devsetu.io';

interface FooterLink {
  label: string;
  to: string;
}

interface PlatformFooterProps {
  signedIn: boolean;
  onRequestLogin: () => void;
}

export default function PlatformFooter({ signedIn, onRequestLogin }: PlatformFooterProps): JSX.Element {
  const year = new Date().getFullYear();

  const learnLinks: FooterLink[] = [
    { label: 'Tracks', to: '/track' },
    { label: 'Majors', to: MAJORS_PATH },
    { label: 'Minors', to: MINORS_PATH },
    { label: 'Paper of the Month', to: MONTHLY_PAPER_PATH },
  ];

  const communityLinks: FooterLink[] = [
    { label: 'Leaderboard', to: LEADERBOARD_PATH },
    { label: 'Pricing', to: PRICING_PATH },
  ];

  return (
    <footer className="platform-footer">
      <div className="platform-footer-inner">
        <div className="platform-footer-brand">
          <Link to="/track" className="platform-footer-mark" aria-label="DevSetu home">
            <BrandMark className="brand-mark brand-mark--sm" title="" />
            <span>DevSetu</span>
          </Link>
          <p className="platform-footer-tagline">The bridge to become a versatile engineer.</p>
          <a className="platform-footer-email" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </div>

        <nav className="platform-footer-col" aria-label="Learn">
          <p className="platform-footer-heading">Learn</p>
          <ul>
            {learnLinks.map((link) => (
              <li key={link.to}>
                <Link to={link.to}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav className="platform-footer-col" aria-label="Community">
          <p className="platform-footer-heading">Community</p>
          <ul>
            {communityLinks.map((link) => (
              <li key={link.to}>
                <Link to={link.to}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav className="platform-footer-col" aria-label="Account">
          <p className="platform-footer-heading">Account</p>
          <ul>
            {signedIn ? (
              <>
                <li><Link to="/profile">Profile</Link></li>
                <li><Link to="/profile?section=subscriptions">Subscriptions</Link></li>
                <li><Link to="/profile?section=privacy">Privacy</Link></li>
                <li><Link to="/profile?section=contact">Contact us</Link></li>
              </>
            ) : (
              <>
                <li>
                  <button type="button" className="platform-footer-linkbtn" onClick={onRequestLogin}>
                    Sign in
                  </button>
                </li>
                <li><a href={`mailto:${CONTACT_EMAIL}`}>Contact us</a></li>
              </>
            )}
          </ul>
        </nav>
      </div>

      <div className="platform-footer-bottom">
        <span>© {year} DevSetu. All rights reserved.</span>
        <span className="platform-footer-made">Built for engineers who ship.</span>
      </div>
    </footer>
  );
}
