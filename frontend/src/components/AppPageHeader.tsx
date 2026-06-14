import React from 'react';

interface AppPageHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  meta?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}

export default function AppPageHeader({
  eyebrow,
  title,
  lead,
  meta,
  aside,
  className = '',
}: AppPageHeaderProps): JSX.Element {
  const wide = Boolean(aside);

  return (
    <header
      className={[
        'app-page-header',
        wide ? 'app-page-header--wide' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <div className="app-page-header-main">
        {eyebrow && <p className="app-page-eyebrow">{eyebrow}</p>}
        <div className="app-page-header-row">
          <h1 className="app-page-title">{title}</h1>
          {meta != null && meta !== '' && (
            <span className="app-page-meta">{meta}</span>
          )}
        </div>
        {lead && <p className="app-page-lead">{lead}</p>}
      </div>
      {aside && <div className="app-page-header-aside">{aside}</div>}
    </header>
  );
}
