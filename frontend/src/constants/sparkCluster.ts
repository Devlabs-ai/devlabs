import type { SparkPlatformLimits, SparkPlatformSpec } from '../types/domain';

/** Fixed cluster + Spark conf options for scored performance labs. */
export const LAB_EXECUTOR_COUNTS = [1, 2, 3, 4] as const;
export const LAB_EXECUTOR_CORES = [1, 2] as const;
export const LAB_DRIVER_CORES = [1, 2] as const;
export const LAB_MEMORY_OPTIONS = ['512m', '768m', '1g', '1536m', '2g'] as const;
export const LAB_SHUFFLE_PARTITIONS = [8, 16, 32, 64, 128, 200] as const;
export const LAB_AUTO_BROADCAST_OPTIONS = [
  { value: '-1', label: 'Off (−1)' },
  { value: '10485760', label: '10 MB (default)' },
  { value: '52428800', label: '50 MB' },
] as const;
export const LAB_AQE_OPTIONS = [
  { value: 'false', label: 'Off' },
  { value: 'true', label: 'On' },
] as const;

export type LabClusterDraft = {
  limits: SparkPlatformLimits;
  sparkConf: Record<string, string>;
};

export function clusterDraftFromPlatform(platform: SparkPlatformSpec): LabClusterDraft {
  const limits = platform.limits || {
    driver: 1,
    driverMemory: '1g',
    executors: 2,
    executorCores: 1,
    executorMemory: '512m',
    hardTimeoutSeconds: 600,
  };
  const sparkConf = { ...(platform.sparkConf || {}) };
  if (sparkConf['spark.sql.adaptive.enabled'] == null) {
    sparkConf['spark.sql.adaptive.enabled'] = 'false';
  }
  if (sparkConf['spark.sql.autoBroadcastJoinThreshold'] == null) {
    sparkConf['spark.sql.autoBroadcastJoinThreshold'] = '-1';
  }
  return { limits: { ...limits }, sparkConf };
}

export function shufflePartitionsFromConf(sparkConf: Record<string, string>): number {
  const raw = sparkConf['spark.sql.shuffle.partitions'];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 32;
}

export function applyShufflePartitions(
  sparkConf: Record<string, string>,
  shufflePartitions: number,
): Record<string, string> {
  const next = { ...sparkConf };
  if (shufflePartitions > 0) {
    next['spark.sql.shuffle.partitions'] = String(shufflePartitions);
  } else {
    delete next['spark.sql.shuffle.partitions'];
  }
  return next;
}

export function formatClusterSummary(draft: LabClusterDraft): string {
  const l = draft.limits;
  const aqe = draft.sparkConf['spark.sql.adaptive.enabled'] === 'true' ? 'on' : 'off';
  const sh = draft.sparkConf['spark.sql.shuffle.partitions'] || 'default';
  const bhj = draft.sparkConf['spark.sql.autoBroadcastJoinThreshold'] ?? 'default';
  return `${l.executors}×${l.executorCores}core ${l.executorMemory} · drv ${l.driver}×${l.driverMemory} · AQE ${aqe} · shuffle ${sh} · BHJ ${bhj}`;
}
