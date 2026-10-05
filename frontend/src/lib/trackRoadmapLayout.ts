/** Vertical roadmap: symmetric S-curve spine; milestones on alternating sides. */

export type RoadmapLayoutMode = 'desktop' | 'mobile';

/** SVG viewBox height — Y positions are 0–100 in this space. */
export const ROADMAP_VIEW_HEIGHT = 100;

function roadPinX(mode: RoadmapLayoutMode, index: number): number {
  const left = mode === 'mobile' ? 41 : 36;
  const right = mode === 'mobile' ? 59 : 64;
  return index % 2 === 0 ? left : right;
}

/** Road centerline X (% width) — alternates left / right for a symmetric curve. */
export function layoutRoadmapPinXs(
  nodes: ReadonlyArray<{ key: string }>,
  _trackLabel: string,
  mode: RoadmapLayoutMode = 'desktop',
): number[] {
  return nodes.map((_, i) => roadPinX(mode, i));
}

export function milestoneSide(index: number): 'left' | 'right' {
  return index % 2 === 0 ? 'left' : 'right';
}

export function buildRoadmapPathD(pinXs: number[], yUnits: number[]): string {
  if (pinXs.length === 0) return '';
  const parts: string[] = [];

  for (let i = 0; i < pinXs.length; i += 1) {
    const y = yUnits[i] ?? ROADMAP_VIEW_HEIGHT / 2;
    const x = pinXs[i];
    if (i === 0) {
      parts.push(`M ${x} ${y}`);
      continue;
    }
    const prevY = yUnits[i - 1] ?? y;
    const prevX = pinXs[i - 1];
    const dy = y - prevY;
    const cp1y = prevY + dy * 0.32;
    const cp2y = prevY + dy * 0.68;
    parts.push(`C ${prevX} ${cp1y}, ${x} ${cp2y}, ${x} ${y}`);
  }

  return parts.join(' ');
}

/** Evenly spaced Y until DOM measurement runs. */
export function fallbackRoadmapYUnits(nodeCount: number): number[] {
  if (nodeCount <= 0) return [ROADMAP_VIEW_HEIGHT / 2];
  return Array.from({ length: nodeCount }, (_, i) => ((i + 0.5) / nodeCount) * ROADMAP_VIEW_HEIGHT);
}

/** Connector endpoint at the milestone circle (toward the road). */
export function milestoneConnectorX(
  side: 'left' | 'right',
  mode: RoadmapLayoutMode = 'desktop',
): number {
  if (mode === 'mobile') return side === 'left' ? 24 : 76;
  return side === 'left' ? 9 : 91;
}

export type RoadmapRowGeometry = {
  /** Y in SVG viewBox units (0–ROADMAP_VIEW_HEIGHT). */
  svgY: number;
  /** Milestone center X in SVG viewBox units (0–100). */
  milestoneSvgX: number;
  /** Anchor top within the row (%). */
  anchorTopPct: number;
};

export function measureRoadmapRowGeometry(
  canvasEl: HTMLElement,
  rowEls: ReadonlyArray<HTMLElement | null>,
  milestoneEls: ReadonlyArray<HTMLElement | null>,
): RoadmapRowGeometry[] | null {
  const canvasRect = canvasEl.getBoundingClientRect();
  if (canvasRect.height <= 0 || canvasRect.width <= 0) return null;

  const rows: RoadmapRowGeometry[] = [];

  for (let i = 0; i < rowEls.length; i += 1) {
    const rowEl = rowEls[i];
    const milestoneEl = milestoneEls[i];
    if (!rowEl || !milestoneEl) return null;

    const rowRect = rowEl.getBoundingClientRect();
    const milestoneRect = milestoneEl.getBoundingClientRect();
    if (rowRect.height <= 0) return null;

    const milestoneCy = milestoneRect.top + milestoneRect.height / 2;
    const milestoneCx = milestoneRect.left + milestoneRect.width / 2;

    rows.push({
      svgY:
        ((milestoneCy - canvasRect.top) / canvasRect.height) * ROADMAP_VIEW_HEIGHT,
      milestoneSvgX:
        ((milestoneCx - canvasRect.left) / canvasRect.width) * 100,
      anchorTopPct: ((milestoneCy - rowRect.top) / rowRect.height) * 100,
    });
  }

  return rows.length === rowEls.length ? rows : null;
}
