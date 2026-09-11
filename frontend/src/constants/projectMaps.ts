/**
 * Cartographic view of a project's module plan.
 *
 * Two layers, deliberately kept apart:
 *
 *   - The plate (`art`) is the map image. Markers and the traveling light
 *     are HTML on top, so the plan can change without redrawing terrain.
 *   - The markers below are data. They position each module on that terrain in
 *     normalized coordinates, and the UI renders labels, ordering, status, and
 *     links from `PROJECTS`.
 *
 * Adding a module means adding a marker here. Only a change of terrain needs
 * new art.
 */

export interface MapMarker {
  /** Must match a module id in the project's plan. */
  moduleId: string;
  /** Position on the plate, 0..1 from the top-left corner. */
  x: number;
  y: number;
  /** Cartographic name for the landmark. Flavour, not navigation. */
  place: string;
  /** Which way the label sits from the marker dot. */
  anchor: 'top' | 'bottom' | 'left' | 'right';
}

export interface ProjectMapSpec {
  projectId: string;
  /** Plate served from /public. Terrain only, no lettering. */
  art: string;
  /** Intrinsic size of the plate, used for the scene aspect ratio. */
  width: number;
  height: number;
  /** Cartouche title and the sea it sits in. */
  title: string;
  ocean: string;
  markers: MapMarker[];
}

const CINDER_MAP: ProjectMapSpec = {
  projectId: 'cinder',
  art: '/maps/cinder.png',
  width: 1024,
  height: 1024,
  title: 'The Cinder Coast',
  ocean: 'Sea of Single Threads',
  markers: [
    { moduleId: 'tcp-server', x: 0.07, y: 0.63, place: 'Harbour of Accept', anchor: 'right' },
    { moduleId: 'event-loop', x: 0.20, y: 0.34, place: 'Loop Light', anchor: 'top' },
    { moduleId: 'csp-protocol', x: 0.30, y: 0.58, place: 'Protocol Narrows', anchor: 'bottom' },
    { moduleId: 'commands', x: 0.42, y: 0.36, place: 'Dispatch Crossing', anchor: 'top' },
    { moduleId: 'keyspace', x: 0.48, y: 0.72, place: 'Expiry Marsh', anchor: 'bottom' },
    { moduleId: 'append-only-log', x: 0.64, y: 0.55, place: 'Append Foothills', anchor: 'bottom' },
    { moduleId: 'recovery', x: 0.76, y: 0.32, place: 'Recovery Pass', anchor: 'top' },
    { moduleId: 'compaction', x: 0.86, y: 0.58, place: 'Compaction Quarry', anchor: 'bottom' },
    { moduleId: 'benchmarks', x: 0.92, y: 0.18, place: 'Benchmark Peak', anchor: 'left' },
  ],
};

const MAPS: ProjectMapSpec[] = [CINDER_MAP];

export function getProjectMap(projectId: string | null | undefined): ProjectMapSpec | null {
  if (!projectId) return null;
  return MAPS.find((m) => m.projectId === projectId) || null;
}
