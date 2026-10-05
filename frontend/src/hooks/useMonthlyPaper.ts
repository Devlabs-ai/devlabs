import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useAppState } from '../context/AppStateContext';
import { fetchMonthlyPaper, type MonthlyPaperState } from '../services/monthlyPaperApi';

/**
 * The current Paper of the Month for the signed-in user (or guest). The card and the
 * mobile banner mount together on the track page, so they share one request per user.
 */
let cache: { key: string; promise: Promise<MonthlyPaperState> } | null = null;

function load(key: string, fresh: boolean): Promise<MonthlyPaperState> {
  if (fresh || !cache || cache.key !== key) {
    const promise = fetchMonthlyPaper();
    cache = { key, promise };
    promise.catch(() => {
      if (cache?.promise === promise) cache = null;
    });
  }
  return cache.promise;
}

export function useMonthlyPaper(): {
  state: MonthlyPaperState | null;
  reload: () => void;
  setState: Dispatch<SetStateAction<MonthlyPaperState | null>>;
} {
  const { authMode, currentUser } = useAppState();
  const key = authMode === 'interviewer' ? currentUser?.email || 'me' : 'guest';
  const [state, setState] = useState<MonthlyPaperState | null>(null);

  const run = useCallback(
    (fresh: boolean) => {
      let live = true;
      load(key, fresh)
        .then((s) => { if (live) setState(s); })
        .catch(() => { if (live) setState(null); });
      return () => { live = false; };
    },
    [key],
  );

  useEffect(() => {
    if (authMode === 'resolving') return undefined;
    return run(false);
  }, [run, authMode]);

  const reload = useCallback(() => { run(true); }, [run]);
  return { state, reload, setState };
}
