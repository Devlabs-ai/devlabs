'use strict';

/**
 * Per-challenge submission scoring / pace labels.
 *
 * Functional match is required first (the existing grader). A challenge may
 * then declare scoring.executionTime:
 *
 *   bands     — adjective from Spark History jobs-wall (no points)
 *   maxPoints — optional later; slower than target → maxPoints * (target/actual)
 */

export type PaceTone = 'quick' | 'brisk' | 'steady' | 'slow';

export type PaceBand = {
  /** Inclusive upper bound. null = catch-all (slowest band). */
  maxMs: number | null;
  label: string;
  tone: PaceTone;
};

export type ExecutionTimeScoring = {
  targetMs?: number;
  maxPoints?: number;
  /** Extra points per second faster than target. 0 = no under-target bonus. */
  bonusPerSecond?: number;
  bands?: PaceBand[];
};

export type ChallengeScoringSpec = {
  executionTime?: ExecutionTimeScoring;
};

export type GradePace = {
  label: string;
  tone: PaceTone;
};

export type GradeScore = {
  functionalPassed: boolean;
  executionMs: number | null;
  targetMs?: number;
  maxPoints?: number;
  bonusPerSecond?: number;
  points?: number;
  pace?: GradePace | null;
};

export type ScoredGrade = {
  passed: boolean;
  kind: string;
  summary: string;
  checks: Array<{ id: string; label: string; passed: boolean; detail?: string }>;
  score?: GradeScore;
  [key: string]: unknown;
};

const TONES: PaceTone[] = ['quick', 'brisk', 'steady', 'slow'];

function asPositiveNumber(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseTone(raw: unknown, fallback: PaceTone): PaceTone {
  const t = String(raw || '').trim().toLowerCase();
  return (TONES as string[]).includes(t) ? (t as PaceTone) : fallback;
}

function parseBands(raw: unknown): PaceBand[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const bands: PaceBand[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const rec = raw[i];
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    const row = rec as Record<string, unknown>;
    const label = String(row.label || '').trim();
    if (!label) continue;
    const maxMs =
      asPositiveNumber(row.maxMs)
      ?? (asPositiveNumber(row.maxSeconds) != null
        ? (asPositiveNumber(row.maxSeconds) as number) * 1000
        : null);
    const fallbackTone = TONES[Math.min(i, TONES.length - 1)];
    bands.push({
      maxMs,
      label,
      tone: parseTone(row.tone, fallbackTone),
    });
  }
  return bands.length ? bands : undefined;
}

export function resolvePace(executionMs: number, bands: PaceBand[]): GradePace {
  const ordered = [...bands].sort((a, b) => {
    if (a.maxMs == null) return 1;
    if (b.maxMs == null) return -1;
    return a.maxMs - b.maxMs;
  });
  const hit = ordered.find((b) => b.maxMs == null || executionMs < b.maxMs) || ordered[ordered.length - 1];
  return { label: hit.label, tone: hit.tone };
}

export function parseScoringSpec(raw: unknown): ChallengeScoringSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const et = (raw as { executionTime?: unknown }).executionTime;
  if (!et || typeof et !== 'object' || Array.isArray(et)) return null;
  const rec = et as Record<string, unknown>;
  const bands = parseBands(rec.bands);
  const maxPoints = asPositiveNumber(rec.maxPoints);
  const targetMs =
    asPositiveNumber(rec.targetMs)
    ?? (asPositiveNumber(rec.targetSeconds) != null
      ? (asPositiveNumber(rec.targetSeconds) as number) * 1000
      : null);
  if (!bands && (maxPoints == null || targetMs == null)) return null;
  const bonusRaw = rec.bonusPerSecond;
  const bonusPerSecond =
    bonusRaw == null || bonusRaw === ''
      ? 0
      : (asPositiveNumber(bonusRaw) ?? 0);
  return {
    executionTime: {
      ...(targetMs != null ? { targetMs } : {}),
      ...(maxPoints != null ? { maxPoints } : {}),
      bonusPerSecond,
      ...(bands ? { bands } : {}),
    },
  };
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const sec = ms / 1000;
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function formatTargetMs(ms: number): string {
  const sec = ms / 1000;
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = sec / 60;
  const rounded = Math.round(min * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} min` : `${rounded} min`;
}

export function formatPoints(points: number): string {
  const r = Math.round(points * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function executionTimeDetail(score: GradeScore, spec: ExecutionTimeScoring): string {
  const dur = formatDurationMs(score.executionMs as number);
  if (score.pace) return `${dur} — ${score.pace.label}`;
  if (spec.maxPoints == null || spec.targetMs == null || score.points == null) {
    return dur;
  }
  const pts = formatPoints(score.points);
  const max = formatPoints(spec.maxPoints);
  const target = formatTargetMs(spec.targetMs);
  const actual = score.executionMs as number;
  if (actual < spec.targetMs && (spec.bonusPerSecond || 0) > 0) {
    const secondsUnder = (spec.targetMs - actual) / 1000;
    const bonus = Math.round(secondsUnder * spec.bonusPerSecond * 10) / 10;
    return `${dur} → ${pts} (${max} at ${target} + ${formatPoints(bonus)} for ${secondsUnder.toFixed(1)}s under)`;
  }
  if (actual > spec.targetMs) {
    return `${dur} → ${pts} (slower than ${target})`;
  }
  return `${dur} → ${pts} (target ${target})`;
}

export function computeExecutionPoints(
  functionalPassed: boolean,
  executionMs: number | null,
  spec: ExecutionTimeScoring,
): number {
  if (spec.maxPoints == null || spec.targetMs == null) return 0;
  if (!functionalPassed) return 0;
  if (executionMs == null || !Number.isFinite(executionMs) || executionMs <= 0) return 0;
  if (executionMs <= spec.targetMs) {
    const secondsUnder = (spec.targetMs - executionMs) / 1000;
    const bonus = (spec.bonusPerSecond || 0) * secondsUnder;
    return Math.round((spec.maxPoints + bonus) * 10) / 10;
  }
  const raw = spec.maxPoints * (spec.targetMs / executionMs);
  return Math.round(raw * 10) / 10;
}

export function attachExecutionScore<T extends ScoredGrade>(
  grade: T,
  spec: ExecutionTimeScoring,
  executionMs: number | null,
): T {
  const functionalPassed = Boolean(grade.passed);
  const hasPoints = spec.maxPoints != null && spec.targetMs != null;
  const points = hasPoints ? computeExecutionPoints(functionalPassed, executionMs, spec) : undefined;
  const execMs = executionMs != null && executionMs > 0 ? Math.round(executionMs) : null;
  const pace =
    functionalPassed && execMs != null && spec.bands?.length
      ? resolvePace(execMs, spec.bands)
      : null;
  const score: GradeScore = {
    functionalPassed,
    executionMs: execMs,
    ...(spec.targetMs != null ? { targetMs: spec.targetMs } : {}),
    ...(spec.maxPoints != null ? { maxPoints: spec.maxPoints } : {}),
    ...(hasPoints ? { bonusPerSecond: spec.bonusPerSecond || 0, points } : {}),
    pace,
  };

  const checks = (grade.checks || []).filter((c) => c.id !== 'execution_time');
  const hasTime = score.executionMs != null;
  if (!functionalPassed || hasTime) {
    checks.push({
      id: 'execution_time',
      label: pace ? 'Execution pace' : 'Execution time vs target',
      passed: functionalPassed && hasTime,
      detail: !functionalPassed
        ? (hasPoints ? '0 — output must match reference first' : 'Output must match reference first')
        : executionTimeDetail(score, spec),
    });
  }

  let summary = String(grade.summary || '');
  if (functionalPassed) {
    if (!hasTime) {
      summary = 'Passed — waiting for History execution time';
    } else if (pace) {
      summary = `Passed — ${pace.label} (${formatDurationMs(score.executionMs as number)})`;
    } else if (hasPoints && points != null && spec.targetMs != null) {
      summary = `Passed — ${formatPoints(points)} (exec ${formatDurationMs(score.executionMs as number)}, target ${formatTargetMs(spec.targetMs)})`;
    }
  } else if (hasPoints && points != null) {
    const scored = formatPoints(points);
    if (!summary.includes(scored)) summary = `${summary} · ${scored}`;
  }

  return {
    ...grade,
    // Time never flips a functional pass into a fail.
    passed: functionalPassed,
    summary,
    checks,
    score,
  };
}

export function scoreNeedsBackfill(
  grade: unknown,
  executionMs: number | null,
  spec?: ExecutionTimeScoring,
): boolean {
  if (!grade || typeof grade !== 'object') return false;
  const score = (grade as { score?: GradeScore }).score;
  const actual = executionMs != null && executionMs > 0 ? executionMs : (score?.executionMs ?? null);
  if (!score) return actual != null && actual > 0;
  if (spec?.bands?.length && actual != null && actual > 0) {
    const want = resolvePace(actual, spec.bands);
    if (!score.pace || score.pace.label !== want.label || score.pace.tone !== want.tone) {
      return true;
    }
  }
  if (
    spec
    && spec.maxPoints != null
    && spec.targetMs != null
    && actual != null
    && actual > 0
    && (
      score.targetMs !== spec.targetMs
      || score.maxPoints !== spec.maxPoints
      || (score.bonusPerSecond ?? 0) !== (spec.bonusPerSecond || 0)
    )
  ) {
    return true;
  }
  if (actual == null || actual <= 0) return false;
  if (score.executionMs == null || score.executionMs <= 0) return true;
  const summary = String((grade as { summary?: string }).summary || '');
  if (spec?.maxPoints != null && summary.includes(`/${formatPoints(spec.maxPoints)}`)) return true;
  return Math.abs(score.executionMs - actual) > 500;
}

module.exports = {
  parseScoringSpec,
  attachExecutionScore,
  scoreNeedsBackfill,
  computeExecutionPoints,
  resolvePace,
  formatDurationMs,
  formatTargetMs,
  formatPoints,
};
