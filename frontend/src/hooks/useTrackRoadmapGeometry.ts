import { useLayoutEffect, useState, type MutableRefObject, type RefObject } from 'react';
import {
  measureRoadmapRowGeometry,
  type RoadmapRowGeometry,
} from '../lib/trackRoadmapLayout';

export function useTrackRoadmapGeometry(
  open: boolean,
  nodeCount: number,
  canvasRef: RefObject<HTMLDivElement | null>,
  rowRefs: MutableRefObject<(HTMLLIElement | null)[]>,
  milestoneRefs: MutableRefObject<(HTMLElement | null)[]>,
): RoadmapRowGeometry[] | null {
  const [geometry, setGeometry] = useState<RoadmapRowGeometry[] | null>(null);

  useLayoutEffect(() => {
    if (!open || nodeCount === 0) {
      setGeometry(null);
      return undefined;
    }

    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const measure = (): void => {
      const rows = rowRefs.current.slice(0, nodeCount);
      const milestones = milestoneRefs.current.slice(0, nodeCount);
      const next = measureRoadmapRowGeometry(canvas, rows, milestones);
      setGeometry(next);
    };

    measure();

    const ro = new ResizeObserver(() => measure());
    ro.observe(canvas);
    rowRefs.current.slice(0, nodeCount).forEach((el) => {
      if (el) ro.observe(el);
    });

    const scrollParent = canvas.closest('.track-roadmap-scroll');
    scrollParent?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);

    return () => {
      ro.disconnect();
      scrollParent?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [open, nodeCount, canvasRef, rowRefs, milestoneRefs]);

  return geometry;
}
