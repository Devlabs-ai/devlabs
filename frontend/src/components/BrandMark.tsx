import React from 'react';

interface BrandMarkProps {
  className?: string;
  title?: string;
}

/** Lab + node mark — emerald flask outline with sky data node (DevLabs). */
export default function BrandMark({
  className = 'brand-mark',
  title = 'DevLabs',
}: BrandMarkProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {/* Left flask wall: neck → flare → bottom (gap at center) */}
      <path
        d="M25.5 19.5v9.2L12.8 48.2c-.6 1-.2 2.3.9 2.8.3.1.6.2.9.2H29"
        stroke="#10b981"
        strokeWidth="5.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right flask wall */}
      <path
        d="M38.5 19.5v9.2L51.2 48.2c.6 1 .2 2.3-.9 2.8-.3.1-.6.2-.9.2H35"
        stroke="#10b981"
        strokeWidth="5.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Data node above the neck */}
      <circle cx="32" cy="12" r="5.5" fill="#38bdf8" />
    </svg>
  );
}
