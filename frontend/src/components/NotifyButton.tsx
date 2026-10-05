import React, { useEffect, useState } from 'react';
import { useAppState } from '../context/AppStateContext';
import { fetchNotifyItems, notifyKey, setNotify, type NotifyKind } from '../services/notifyApi';

let cachedItems: Promise<Set<string>> | null = null;
let cachedFor: string | null = null;

/** One fetch per signed-in user, shared by every bell on the page. */
function loadNotifyItems(userKey: string): Promise<Set<string>> {
  if (!cachedItems || cachedFor !== userKey) {
    cachedFor = userKey;
    cachedItems = fetchNotifyItems().catch(() => new Set<string>());
  }
  return cachedItems;
}

function BellIcon({ filled }: { filled: boolean }): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} aria-hidden>
      <path
        d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function NotifyButton({ kind, itemId, label }: {
  kind: NotifyKind;
  itemId: string;
  /** Shown in the tooltip, e.g. "Cinder". */
  label: string;
}): JSX.Element {
  const { authMode, currentUser, onRequestLogin } = useAppState();
  const signedIn = authMode === 'interviewer';
  const userKey = currentUser?.email || currentUser?.id || '';
  const key = notifyKey(kind, itemId);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn) {
      setOn(false);
      return undefined;
    }
    let cancelled = false;
    void loadNotifyItems(String(userKey)).then((items) => {
      if (!cancelled) setOn(items.has(key));
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, userKey, key]);

  const onClick = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    if (!signedIn) {
      onRequestLogin();
      return;
    }
    if (busy) return;
    const next = !on;
    setBusy(true);
    setOn(next);
    try {
      await setNotify(kind, itemId, next);
      const items = await loadNotifyItems(String(userKey));
      if (next) items.add(key);
      else items.delete(key);
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  };

  const title = on
    ? `You'll be notified when ${label} opens. Click to stop.`
    : `Notify me when ${label} opens`;

  return (
    <button
      type="button"
      className={`notify-btn${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={title}
      title={title}
      disabled={busy}
      onClick={(e) => void onClick(e)}
    >
      <BellIcon filled={on} />
    </button>
  );
}
