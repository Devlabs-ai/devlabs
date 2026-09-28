import React from 'react';

interface ChromeIconButtonProps {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger' | 'accent';
  children: React.ReactNode;
  className?: string;
}

const TONE_COLOR: Record<NonNullable<ChromeIconButtonProps['tone']>, string> = {
  default: '#e8eaf4',
  danger: '#f87171',
  accent: '#34d399',
};

/** Icon control that escapes global `button` gradient styles. */
export function ChromeIconButton({
  title,
  onClick,
  disabled,
  tone = 'default',
  children,
  className = '',
}: ChromeIconButtonProps): JSX.Element {
  const color = TONE_COLOR[tone];
  return (
    <button
      type="button"
      className={`chrome-icon-btn ${className}`.trim()}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        padding: 0,
        margin: 0,
        border: 'none',
        borderRadius: 6,
        background: 'transparent',
        boxShadow: 'none',
        color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        filter: 'none',
        transform: 'none',
        letterSpacing: 'normal',
        fontWeight: 500,
      }}
    >
      {children}
    </button>
  );
}

export function IconPen({ color = 'currentColor' }: { color?: string }): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
      />
      <path
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m15 5 4 4"
      />
    </svg>
  );
}

export function IconFolderOpen({ color = 'currentColor' }: { color?: string }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
      />
    </svg>
  );
}

export function IconPlay({ color = '#34d399' }: { color?: string }): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path fill={color} d="M8 5.14v13.72L19.5 12 8 5.14z" />
    </svg>
  );
}

export function IconStop({ color = '#f87171' }: { color?: string }): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden focusable="false">
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.75" fill={color} />
    </svg>
  );
}

export function IconLibrary({ color = '#e8eaf4' }: { color?: string }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinejoin="round"
        d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v9A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5v-11z"
      />
    </svg>
  );
}

export function IconSubmit({ color = '#34d399' }: { color?: string }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 16V7m0 0l-3.5 3.5M12 7l3.5 3.5"
      />
      <path
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        d="M7.5 12.5a4.5 4.5 0 1 1 1.6 8.7h7.4a4 4 0 0 0 .7-7.95 5.5 5.5 0 0 0-10.3-1.55A4.5 4.5 0 0 1 7.5 12.5z"
      />
    </svg>
  );
}

export function IconSubmissions({ color = '#34d399' }: { color?: string }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        d="M8 4h9.5A1.5 1.5 0 0 1 19 5.5v14A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5V7.5L8 4z"
      />
      <path fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" d="M8 4v3.5H5" />
      <path
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M9 12h6M9 15.5h6M9 8.5h3"
      />
    </svg>
  );
}

/** Stacked coins — profile tokens shelf. */
export function IconCoins({
  color = 'currentColor',
  size = 28,
}: {
  color?: string;
  size?: number;
}): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <ellipse cx="14" cy="18.5" rx="8.5" ry="4.2" stroke={color} strokeWidth="1.5" opacity="0.55" />
      <ellipse
        cx="14"
        cy="14"
        rx="8.5"
        ry="4.2"
        stroke={color}
        strokeWidth="1.5"
        fill="rgba(240,198,116,0.08)"
      />
      <ellipse
        cx="14"
        cy="9.5"
        rx="8.5"
        ry="4.2"
        stroke={color}
        strokeWidth="1.6"
        fill="rgba(240,198,116,0.14)"
      />
      <path
        d="M14 5.4c3.7 0 6.7 1.5 6.7 3.4S17.7 12.2 14 12.2 7.3 10.7 7.3 8.8 10.3 5.4 14 5.4Z"
        stroke={color}
        strokeWidth="1.2"
        opacity="0.9"
      />
    </svg>
  );
}

/** Crest / badge outline — profile badges shelf. */
export function IconBadge({ color = 'currentColor' }: { color?: string }): JSX.Element {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d="M14 3.8 17.6 5.6 21.8 6.2 22.2 10.4 24.2 13.8 22.2 17.2 21.8 21.4 17.6 22 14 23.8 10.4 22 6.2 21.4 5.8 17.2 3.8 13.8 5.8 10.4 6.2 6.2 10.4 5.6 14 3.8Z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="rgba(126,184,232,0.1)"
      />
      <circle cx="14" cy="14" r="3.2" stroke={color} strokeWidth="1.4" />
    </svg>
  );
}


