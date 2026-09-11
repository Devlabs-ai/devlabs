import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export interface PlayChromePrimary {
  label: string;
  busyLabel?: string;
  onClick: () => void;
  busy?: boolean;
}

export interface PlayChromeState {
  leading?: React.ReactNode | null;
  run?: PlayChromePrimary | null;
  primary?: PlayChromePrimary | null;
  /** Submissions / history control (icon+label in header). */
  submissions?: PlayChromePrimary | null;
  status?: React.ReactNode | null;
}

interface PlayChromeContextValue {
  chrome: PlayChromeState;
  setPlayChrome: (next: PlayChromeState | null) => void;
}

const PlayChromeContext = createContext<PlayChromeContextValue | null>(null);

const EMPTY: PlayChromeState = {
  leading: null,
  run: null,
  primary: null,
  submissions: null,
  status: null,
};

export function PlayChromeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [chrome, setChrome] = useState<PlayChromeState>(EMPTY);

  const setPlayChrome = useCallback((next: PlayChromeState | null) => {
    setChrome(next ? { ...EMPTY, ...next } : EMPTY);
  }, []);

  const value = useMemo(() => ({ chrome, setPlayChrome }), [chrome, setPlayChrome]);

  return (
    <PlayChromeContext.Provider value={value}>
      {children}
    </PlayChromeContext.Provider>
  );
}

export function usePlayChrome(): PlayChromeContextValue {
  const ctx = useContext(PlayChromeContext);
  if (!ctx) {
    throw new Error('usePlayChrome must be used within PlayChromeProvider');
  }
  return ctx;
}

/** Register challenge-header actions while a workspace is mounted. */
export function useRegisterPlayChrome(state: PlayChromeState, deps: React.DependencyList): void {
  const { setPlayChrome } = usePlayChrome();
  useEffect(() => {
    setPlayChrome(state);
    return () => setPlayChrome(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
