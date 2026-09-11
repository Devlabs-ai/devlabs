/** Problem-setter Spark knobs — declared per challenge in platformSpec.knobs. */

export interface SparkKnobOption {
  value: string;
  label: string;
}

export interface SparkKnobDef {
  id: string;
  /** Spark config key, e.g. spark.sql.shuffle.partitions */
  conf: string;
  label: string;
  help?: string;
  default: string;
  options: SparkKnobOption[];
}

export type SparkKnobValues = Record<string, string>;

const STORAGE_PREFIX = 'devlabs.sparkLab.knobs.';

export function defaultsFromKnobDefs(defs: SparkKnobDef[] | null | undefined): SparkKnobValues {
  const out: SparkKnobValues = {};
  for (const def of defs || []) {
    if (!def?.id) continue;
    out[def.id] = pickOption(def, def.default);
  }
  return out;
}

export function normalizeKnobValues(
  partial: SparkKnobValues | null | undefined,
  defs: SparkKnobDef[] | null | undefined,
): SparkKnobValues {
  const out: SparkKnobValues = {};
  for (const def of defs || []) {
    if (!def?.id) continue;
    out[def.id] = pickOption(def, partial?.[def.id] ?? def.default);
  }
  return out;
}

export function knobValuesToSparkConf(
  values: SparkKnobValues,
  defs: SparkKnobDef[] | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of defs || []) {
    if (!def?.id || !def.conf) continue;
    const v = values[def.id];
    if (v == null || v === '') continue;
    if (!def.options.some((o) => o.value === v)) continue;
    out[def.conf] = v;
  }
  return out;
}

export function formatKnobSummary(
  values: SparkKnobValues,
  defs: SparkKnobDef[] | null | undefined,
): string {
  const parts: string[] = [];
  for (const def of defs || []) {
    const raw = values[def.id];
    const opt = def.options.find((o) => o.value === raw);
    parts.push(`${def.label} ${opt?.label || raw || def.default}`);
  }
  return parts.join(' · ') || 'defaults';
}

export function readStoredKnobValues(
  challengeId: string,
  defs: SparkKnobDef[] | null | undefined,
): SparkKnobValues {
  const fallback = defaultsFromKnobDefs(defs);
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + challengeId);
    if (!raw) return fallback;
    return normalizeKnobValues(JSON.parse(raw) as SparkKnobValues, defs);
  } catch {
    return fallback;
  }
}

export function storeKnobValues(challengeId: string, values: SparkKnobValues): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + challengeId, JSON.stringify(values));
  } catch {
    /* ignore */
  }
}

function pickOption(def: SparkKnobDef, raw: string | undefined): string {
  const options = Array.isArray(def.options) ? def.options : [];
  if (raw != null && options.some((o) => o.value === raw)) return raw;
  if (options.some((o) => o.value === def.default)) return def.default;
  return options[0]?.value || def.default || '';
}
