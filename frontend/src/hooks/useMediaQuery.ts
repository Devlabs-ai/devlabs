import { useEffect, useState } from 'react';

/** Subscribe to a CSS media query; defaults to `false` before mount (SSR-safe). */
export default function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Shared breakpoint for stacking lab shells and collapsing chrome. */
export const NARROW_UI_QUERY = '(max-width: 960px)';

export function useIsNarrowUi(): boolean {
  return useMediaQuery(NARROW_UI_QUERY);
}
