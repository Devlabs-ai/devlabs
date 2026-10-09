import React, { useState } from 'react';

interface DesktopOnlyNoticeProps {
  /** What is locked, e.g. "terminal and editor". */
  tools?: string;
  onShowBrief?: () => void;
  briefLabel?: string;
}

function IconLaptop(): JSX.Element {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 19h20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 9.5l2 1.5-2 1.5M12 12.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Replaces the hands-on workspace on small screens; the brief stays readable. */
export default function DesktopOnlyNotice({
  tools = 'terminal and editor',
  onShowBrief,
  briefLabel = 'Read the problem',
}: DesktopOnlyNoticeProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const shareLink = async () => {
    try {
      await navigator.share({ title: document.title, url: window.location.href });
    } catch {
      /* dismissed */
    }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div className="col col-main desktop-only-col">
      <div className="desktop-only-notice" role="status">
        <div className="desktop-only-icon">
          <IconLaptop />
        </div>
        <h2 className="desktop-only-title">Continue on a laptop</h2>
        <p className="desktop-only-text">
          The {tools} need a larger screen and a keyboard, so they are only available on a laptop or
          desktop. You can still read everything else here.
        </p>
        <ul className="desktop-only-list">
          <li>Open this same page on your laptop; your progress is saved.</li>
          <li>Screens at least 960px wide get the full workspace.</li>
        </ul>
        <div className="desktop-only-actions">
          {onShowBrief && (
            <button type="button" className="desktop-only-btn desktop-only-btn--primary" onClick={onShowBrief}>
              {briefLabel}
            </button>
          )}
          {canShare ? (
            <button type="button" className="desktop-only-btn" onClick={shareLink}>
              Send link to my laptop
            </button>
          ) : (
            <button type="button" className="desktop-only-btn" onClick={copyLink}>
              {copied ? 'Link copied' : 'Copy link'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
