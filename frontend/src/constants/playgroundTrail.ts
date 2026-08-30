import type { SparkPlatformLimits } from '../types/domain';

/** Selectable trail resources for Spark Playground experiment runs. */
export interface PlaygroundTrailLimits extends SparkPlatformLimits {
  driverMemory: string;
  /** Adaptive Query Execution (spark.sql.adaptive.enabled). */
  aqe: boolean;
  /** spark.sql.shuffle.partitions */
  shufflePartitions: number;
}

export interface PlaygroundTrailPreset {
  id: string;
  label: string;
  blurb: string;
  limits: PlaygroundTrailLimits;
}

export const PLAYGROUND_EXECUTOR_COUNTS = [1, 2, 3, 4, 6, 8] as const;
export const PLAYGROUND_EXECUTOR_CORES = [1, 2, 3, 4] as const;
export const PLAYGROUND_DRIVER_CORES = [1, 2, 4] as const;
export const PLAYGROUND_MEMORY_OPTIONS = ['256m', '512m', '768m', '1g', '1536m', '2g', '4g'] as const;
export const PLAYGROUND_SHUFFLE_PARTITIONS = [2, 4, 8, 16, 32, 64, 128] as const;

export const PLAYGROUND_TRAIL_PRESETS: PlaygroundTrailPreset[] = [
  {
    id: 'cliff-512',
    label: 'Cliff · 512m',
    blurb: '2×512m — classic OOM / spill trail',
    limits: {
      driver: 1,
      driverMemory: '1g',
      executors: 2,
      executorCores: 1,
      executorMemory: '512m',
      aqe: true,
      shufflePartitions: 8,
    },
  },
  {
    id: 'standard-1g',
    label: 'Standard · 1g',
    blurb: '2×1g — default practice trail',
    limits: {
      driver: 1,
      driverMemory: '1g',
      executors: 2,
      executorCores: 1,
      executorMemory: '1g',
      aqe: true,
      shufflePartitions: 8,
    },
  },
  {
    id: 'wide-1g',
    label: 'Wide · 1g',
    blurb: '4×1g — more parallelism',
    limits: {
      driver: 1,
      driverMemory: '1g',
      executors: 4,
      executorCores: 1,
      executorMemory: '1g',
      aqe: true,
      shufflePartitions: 8,
    },
  },
  {
    id: 'heavy-2g',
    label: 'Heavy · 2g',
    blurb: '4×2g — roomy for larger drops',
    limits: {
      driver: 2,
      driverMemory: '2g',
      executors: 4,
      executorCores: 2,
      executorMemory: '2g',
      aqe: true,
      shufflePartitions: 16,
    },
  },
];

export const PLAYGROUND_DEFAULT_TRAIL = PLAYGROUND_TRAIL_PRESETS[1];

const STORAGE_KEY = 'devlabs.sparkPlayground.trailLimits';

export function formatTrailSummary(limits: PlaygroundTrailLimits): string {
  return `${limits.executors}×${limits.executorCores}core ${limits.executorMemory} · drv ${limits.driver}×${limits.driverMemory} · AQE ${limits.aqe ? 'on' : 'off'} · shuffle ${limits.shufflePartitions}`;
}

export function matchTrailPresetId(limits: PlaygroundTrailLimits): string {
  const hit = PLAYGROUND_TRAIL_PRESETS.find((p) =>
    p.limits.driver === limits.driver
    && p.limits.driverMemory === limits.driverMemory
    && p.limits.executors === limits.executors
    && p.limits.executorCores === limits.executorCores
    && p.limits.executorMemory === limits.executorMemory
    && p.limits.aqe === limits.aqe
    && p.limits.shufflePartitions === limits.shufflePartitions,
  );
  return hit?.id || 'custom';
}

export function readStoredTrailLimits(): PlaygroundTrailLimits {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...PLAYGROUND_DEFAULT_TRAIL.limits };
    const parsed = JSON.parse(raw) as Partial<PlaygroundTrailLimits>;
    return normalizeTrailLimits(parsed);
  } catch {
    return { ...PLAYGROUND_DEFAULT_TRAIL.limits };
  }
}

export function storeTrailLimits(limits: PlaygroundTrailLimits): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeTrailLimits(limits)));
  } catch {
    /* ignore */
  }
}

export function normalizeTrailLimits(
  partial: Partial<PlaygroundTrailLimits> | null | undefined,
): PlaygroundTrailLimits {
  const base = PLAYGROUND_DEFAULT_TRAIL.limits;
  const driver = clampInt(partial?.driver, 1, 4, base.driver);
  const executors = clampInt(partial?.executors, 1, 8, base.executors);
  const executorCores = clampInt(partial?.executorCores, 1, 4, base.executorCores);
  const driverMemory = normalizeMemory(partial?.driverMemory, base.driverMemory);
  const executorMemory = normalizeMemory(partial?.executorMemory, base.executorMemory);
  const aqe = typeof partial?.aqe === 'boolean' ? partial.aqe : base.aqe;
  const shufflePartitions = clampInt(
    partial?.shufflePartitions,
    1,
    512,
    base.shufflePartitions,
  );
  return {
    driver,
    driverMemory,
    executors,
    executorCores,
    executorMemory,
    aqe,
    shufflePartitions,
  };
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeMemory(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  if ((PLAYGROUND_MEMORY_OPTIONS as readonly string[]).includes(v)) return v;
  if (/^\d+[kmgt]$/.test(v)) return v;
  return fallback;
}
