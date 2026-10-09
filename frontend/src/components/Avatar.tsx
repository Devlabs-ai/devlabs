import React, { useId } from 'react';

type Preset = { id: string; label: string; from: string; to: string; glyph: JSX.Element };

const G = { fill: 'none', stroke: '#fff', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Ids must match AVATAR_IDS in backend/profile/activity.ts. */
export const AVATAR_PRESETS: Preset[] = [
  { id: 'emerald', label: 'Emerald', from: '#34d399', to: '#065f46', glyph: <path {...G} d="M20 11 29 27H11Z" /> },
  { id: 'ocean', label: 'Ocean', from: '#38bdf8', to: '#1e3a8a', glyph: <path {...G} d="M10 18c3-3 7-3 10 0s7 3 10 0M10 24c3-3 7-3 10 0s7 3 10 0" /> },
  { id: 'sunset', label: 'Sunset', from: '#fb923c', to: '#be123c', glyph: <><path {...G} d="M13 25a7 7 0 0 1 14 0" /><path {...G} d="M10 29h20M20 12v3M12.5 15.5l2 2M27.5 15.5l-2 2" /></> },
  { id: 'violet', label: 'Violet', from: '#a78bfa', to: '#4c1d95', glyph: <path {...G} d="M20 10.5 28.2 15.25v9.5L20 29.5l-8.2-4.75v-9.5Z" /> },
  { id: 'amber', label: 'Amber', from: '#fbbf24', to: '#b45309', glyph: <path {...G} d="m20 10.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L20 25.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9Z" /> },
  { id: 'rose', label: 'Rose', from: '#fb7185', to: '#9f1239', glyph: <path {...G} d="M20 10 30 20 20 30 10 20Z" /> },
  { id: 'mint', label: 'Mint', from: '#6ee7b7', to: '#0f766e', glyph: <path {...G} d="M20 12v16M12 20h16" /> },
  { id: 'slate', label: 'Slate', from: '#94a3b8', to: '#1e293b', glyph: <path {...G} d="m12 15 5 5-5 5M20 26h8" /> },
  { id: 'aurora', label: 'Aurora', from: '#34d399', to: '#6366f1', glyph: <><circle {...G} cx="20" cy="20" r="9" /><circle {...G} cx="20" cy="20" r="4" /></> },
  { id: 'ember', label: 'Ember', from: '#f87171', to: '#7c2d12', glyph: <path {...G} d="M20 30c-5 0-7-3.5-7-7 0-4 3-6 4-10 2 2 2.5 4 2.5 5.5C21 17 22 15 22 13c3 2.5 5 6 5 10 0 3.5-2 7-7 7Z" /> },
  { id: 'glacier', label: 'Glacier', from: '#a5f3fc', to: '#0e7490', glyph: <path {...G} d="M20 10v20M11.3 15l17.4 10M11.3 25l17.4-10" /> },
  { id: 'orchid', label: 'Orchid', from: '#f0abfc', to: '#86198f', glyph: <><circle cx="14" cy="14" r="2.4" fill="#fff" /><circle cx="26" cy="14" r="2.4" fill="#fff" /><circle cx="14" cy="26" r="2.4" fill="#fff" /><circle cx="26" cy="26" r="2.4" fill="#fff" /></> },
];

const BY_ID = new Map(AVATAR_PRESETS.map((p) => [p.id, p]));

export default function Avatar({
  avatar,
  name,
  size = 40,
  className = '',
}: {
  avatar: string | null | undefined;
  name: string;
  size?: number;
  className?: string;
}): JSX.Element {
  const gradientId = useId();
  const preset = avatar ? BY_ID.get(avatar) : undefined;
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <svg
      className={`avatar ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={preset ? `${name} (${preset.label} avatar)` : name}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={preset?.from ?? '#3f3f46'} />
          <stop offset="1" stopColor={preset?.to ?? '#18181b'} />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill={`url(#${gradientId})`} />
      {preset ? (
        <g opacity="0.92">{preset.glyph}</g>
      ) : (
        <text x="20" y="20" dy="0.36em" textAnchor="middle" fontSize="17" fontWeight="600" fill="#e4e4e7">
          {initial}
        </text>
      )}
    </svg>
  );
}

export function AvatarPicker({
  value,
  name,
  disabled,
  onSelect,
}: {
  value: string | null;
  name: string;
  disabled?: boolean;
  onSelect: (id: string | null) => void;
}): JSX.Element {
  return (
    <div className="avatar-picker" role="radiogroup" aria-label="Profile picture">
      {[null, ...AVATAR_PRESETS.map((p) => p.id)].map((id) => {
        const selected = value === id;
        return (
          <button
            key={id ?? 'initial'}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={id ? BY_ID.get(id)?.label : 'Initial'}
            className={`avatar-picker-option${selected ? ' is-selected' : ''}`}
            disabled={disabled}
            onClick={() => onSelect(id)}
          >
            <Avatar avatar={id} name={name} size={44} />
          </button>
        );
      })}
    </div>
  );
}
