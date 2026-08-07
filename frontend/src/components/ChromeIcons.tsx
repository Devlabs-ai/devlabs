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

export function IconClock({ color = '#c8cce0' }: { color?: string }): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="1.75" />
      <path
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 7v5l3 2"
      />
    </svg>
  );
}
