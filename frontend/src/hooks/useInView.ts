import { useEffect, useRef, useState } from 'react';

/** Adds .is-inview when scrolled into view (for staggered slide-in). */
export function useInView<T extends HTMLElement>(rootMargin = '0px 0px -12% 0px'): {
  ref: React.RefObject<T>;
  inView: boolean;
} {
  const ref = useRef<T>(null as unknown as T);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { root: null, rootMargin, threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}
