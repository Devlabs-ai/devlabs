'use strict';

/**
 * Parse / normalize / validate Spark shape contracts from Design Agent output.
 */

import type {
  SparkAggregation,
  SparkChallengeKind,
  SparkDataBlock,
  SparkEvalCollection,
  SparkKindSpec,
  SparkPlatform,
  SparkShapeContract,
  SparkTransform,
  SparkValidationRule,
} from '../../types/sparkShape';

const SHAPE_CONTRACT_HINT = `spark_shape_contract JSON (schemaVersion 1):
{
  "schemaVersion": 1,
  "kind": "implementation | debug",
  "meta": { "name", "slug", "difficulty": "easy|medium|hard", "tags": [], "category", "play?": { "domainId", "panelId" } },
  "brief": { "description": "candidate markdown", "problemStatement": { "overview?", "symptoms?", "yourTask?", "yourTaskSteps?", "hints?", "inputSchema?", "expectedOutput?" } },
  "kindSpec": { "starterMode": "stub|broken", "rootCause?", "bugClass?", "validationSymptoms?" },
  "data": { "mode": "batch|streaming", "businessDate?", "format", "partitions": [], "scale?", "schema": [{ "name", "type", "nullable?" }], "malformed?", "inputLayout?" },
  "transform": { "pattern": "aggregate", "validationRules": [{ "id", "expr", "description?" }], "groupBy": [], "aggregations": [{ "output", "type", "expr", "atol?" }] },
  "platform": { "language": "python", "starterFileName", "limits": { "driver", "executors", "executorCores", "executorMemory" }, "gradeChecks": [] },
  "evalCollection": { "fromJob": { "artifact": "json", "envOutputPath": "OUTPUT_PATH", "wrapper": "rows" }, "keys": [], "columns": [{ "name", "type", "role": "key|value", "atol?" }], "publishAs" }
}`;

function extractTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m[1];
  return last ? last.trim() : null;
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch (e) {
    console.warn('[sparkShape] JSON parse failed:', (e as Error).message);
    return null;
  }
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.trim() : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'spark-challenge';
}

function normalizeKind(raw: unknown): SparkChallengeKind {
  const k = String(raw || '').toLowerCase();
  if (k === 'debug') return 'debug';
  return 'implementation';
}

function normalizeKindSpec(raw: unknown, kind: SparkChallengeKind): SparkKindSpec {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const starterMode =
    o.starterMode === 'broken' || kind === 'debug' ? 'broken' : 'stub';
  const spec: SparkKindSpec = { starterMode };
  if (kind === 'debug') {
    const rootCause = asString(o.rootCause);
    if (rootCause) spec.rootCause = rootCause;
    const bugClass = asString(o.bugClass);
    if (bugClass) {
      spec.bugClass = bugClass as SparkKindSpec['bugClass'];
    }
    if (Array.isArray(o.validationSymptoms)) {
      spec.validationSymptoms = o.validationSymptoms
        .map((s, i) => {
          if (typeof s === 'string' && s.trim()) return { id: i + 1, check: s.trim() };
          if (s && typeof s === 'object' && (s as { check?: string }).check) {
            const row = s as { id?: number; check: string };
            return { id: row.id ?? i + 1, check: String(row.check).trim() };
          }
          return null;
        })
        .filter((s): s is { id: number; check: string } => Boolean(s?.check));
    }
  }
  return spec;
}

function asPartitionNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (typeof x === 'string' && x.trim() && !x.includes('[object Object]')) return x.trim();
      if (x && typeof x === 'object' && (x as { name?: unknown }).name != null) {
        return String((x as { name: unknown }).name).trim();
      }
      return '';
    })
    .filter(Boolean);
}

function normalizeData(raw: unknown, slug: string): SparkDataBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const schemaRaw = Array.isArray(o.schema) ? o.schema : [];
  const schema = schemaRaw
    .map((c) => {
      if (!c || typeof c !== 'object') return null;
      const col = c as Record<string, unknown>;
      const name = asString(col.name);
      if (!name) return null;
      return {
        name,
        type: asString(col.type, 'string'),
        nullable: col.nullable !== false,
      };
    })
    .filter(Boolean) as SparkDataBlock['schema'];
  if (!schema.length) return null;

  const partitions = asPartitionNames(o.partitions);
  const malformedRaw = o.malformed && typeof o.malformed === 'object'
    ? (o.malformed as Record<string, unknown>)
    : null;
  let malformed: SparkDataBlock['malformed'];
  if (malformedRaw) {
    const patterns = asStringArray(malformedRaw.patterns);
    // LLM sometimes emits { nullProductId: 0.5, ... } without enabled/patterns
    const inferred = Object.keys(malformedRaw)
      .filter((k) => !['enabled', 'rate', 'patterns'].includes(k) && Number(malformedRaw[k]) > 0);
    const rate = Number(malformedRaw.rate);
    const scalePct = o.scale && typeof o.scale === 'object'
      ? (o.scale as { malformedPercent?: number }).malformedPercent
      : undefined;
    const rateFromPct = Number(malformedRaw.malformedPercent ?? scalePct);
    malformed = {
      enabled: malformedRaw.enabled === true
        || patterns.length > 0
        || inferred.length > 0
        || (Number.isFinite(rate) && rate > 0)
        || (Number.isFinite(rateFromPct) && rateFromPct > 0),
      rate: Number.isFinite(rate) && rate > 0
        ? rate
        : Number.isFinite(rateFromPct) && rateFromPct > 0
          ? rateFromPct / (rateFromPct > 1 ? 100 : 1)
          : undefined,
      patterns: patterns.length ? patterns : inferred,
    };
  }

  let layout: Record<string, unknown> | null = null;
  if (o.inputLayout && typeof o.inputLayout === 'object') {
    layout = o.inputLayout as Record<string, unknown>;
  } else if (typeof o.inputLayout === 'string' && o.inputLayout.trim()) {
    layout = { targetPrefixHint: `challenges/${slug}/input/`, hiveStyle: true };
  } else if (o.outputLayout && typeof o.outputLayout === 'object') {
    layout = o.outputLayout as Record<string, unknown>;
  }

  return {
    mode: String(o.mode || 'batch').toLowerCase() === 'streaming' ? 'streaming' : 'batch',
    businessDate: asString(o.businessDate) || undefined,
    format: asString(o.format, 'parquet') || 'parquet',
    partitions: partitions.length ? partitions : ['business_date', 'store_id'],
    scale: o.scale && typeof o.scale === 'object' ? (o.scale as SparkDataBlock['scale']) : undefined,
    schema,
    malformed,
    inputLayout: {
      targetPrefixHint: asString(
        layout?.targetPrefixHint,
        `challenges/${slug}/input/`,
      ),
      hiveStyle: layout?.hiveStyle !== false,
    },
  };
}

function normalizeTransform(raw: unknown): SparkTransform | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const rulesRaw = Array.isArray(o.validationRules) ? o.validationRules : [];
  const validationRules: SparkValidationRule[] = rulesRaw
    .map((r, i) => {
      if (!r || typeof r !== 'object') return null;
      const row = r as Record<string, unknown>;
      const expr = asString(row.expr);
      if (!expr) return null;
      return {
        id: asString(row.id, `rule_${i + 1}`),
        description: asString(row.description) || undefined,
        expr,
      };
    })
    .filter(Boolean) as SparkValidationRule[];

  const aggsRaw = Array.isArray(o.aggregations) ? o.aggregations : [];
  const aggregations: SparkAggregation[] = aggsRaw
    .map((a) => {
      if (!a || typeof a !== 'object') return null;
      const row = a as Record<string, unknown>;
      const output = asString(row.output);
      const expr = asString(row.expr);
      if (!output || !expr) return null;
      const atol = row.atol != null ? Number(row.atol) : undefined;
      return {
        output,
        type: asString(row.type, 'int') || 'int',
        expr,
        atol: Number.isFinite(atol as number) ? (atol as number) : undefined,
      };
    })
    .filter(Boolean) as SparkAggregation[];

  if (!validationRules.length || !aggregations.length) return null;

  return {
    pattern: 'aggregate',
    validationRules,
    groupBy: asStringArray(o.groupBy),
    aggregations,
  };
}

function normalizePlatform(raw: unknown): SparkPlatform | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const limits = (o.limits && typeof o.limits === 'object' ? o.limits : {}) as Record<string, unknown>;
  return {
    language: 'python',
    starterFileName: asString(o.starterFileName, 'src/main.py') || 'src/main.py',
    limits: {
      driver: Number(limits.driver) || 1,
      executors: Number(limits.executors) || 2,
      executorCores: Number(limits.executorCores) || 1,
      executorMemory: asString(limits.executorMemory, '1g') || '1g',
    },
    gradeChecks: asStringArray(o.gradeChecks),
  };
}

function normalizeEvalCollection(raw: unknown, slug: string): SparkEvalCollection | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const fromJob = (o.fromJob && typeof o.fromJob === 'object' ? o.fromJob : {}) as Record<string, unknown>;
  const columnsRaw = Array.isArray(o.columns) ? o.columns : [];
  const columns = columnsRaw
    .map((c) => {
      if (!c || typeof c !== 'object') return null;
      const col = c as Record<string, unknown>;
      const name = asString(col.name);
      if (!name) return null;
      const role = String(col.role || 'value').toLowerCase() === 'key' ? 'key' : 'value';
      const atol = col.atol != null ? Number(col.atol) : undefined;
      return {
        name,
        type: asString(col.type, 'string') || 'string',
        role: role as 'key' | 'value',
        atol: Number.isFinite(atol as number) ? (atol as number) : undefined,
      };
    })
    .filter(Boolean) as SparkEvalCollection['columns'];
  if (!columns.length) return null;
  const keys = asStringArray(o.keys);
  return {
    fromJob: {
      artifact: 'json',
      envOutputPath: asString(fromJob.envOutputPath, 'OUTPUT_PATH') || 'OUTPUT_PATH',
      wrapper: asString(fromJob.wrapper, 'rows') || 'rows',
    },
    keys: keys.length ? keys : columns.filter((c) => c.role === 'key').map((c) => c.name),
    columns,
    publishAs: asString(o.publishAs, `challenges/${slug}/eval/solution.json`),
  };
}

function normalizeSparkShapeContract(raw: unknown): SparkShapeContract | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const metaIn = (o.meta && typeof o.meta === 'object' ? o.meta : {}) as Record<string, unknown>;
  const briefIn = (o.brief && typeof o.brief === 'object' ? o.brief : {}) as Record<string, unknown>;
  const name = asString(metaIn.name) || asString(o.name);
  const description = asString(briefIn.description) || asString(o.description);
  if (!name || !description) return null;

  const kind = normalizeKind(o.kind);
  const slug = asString(metaIn.slug) || slugify(name);
  const difficultyRaw = asString(metaIn.difficulty, 'medium').toLowerCase();
  const difficulty =
    difficultyRaw === 'easy' || difficultyRaw === 'hard' ? difficultyRaw : 'medium';

  const data = normalizeData(o.data, slug);
  const transform = normalizeTransform(o.transform);
  const platform = normalizePlatform(o.platform);
  const evalCollection = normalizeEvalCollection(o.evalCollection, slug);
  if (!data || !transform || !platform || !evalCollection) return null;

  const ps = (briefIn.problemStatement && typeof briefIn.problemStatement === 'object'
    ? briefIn.problemStatement
    : {}) as Record<string, unknown>;

  const play = metaIn.play && typeof metaIn.play === 'object'
    ? {
        domainId: asString((metaIn.play as Record<string, unknown>).domainId),
        panelId: asString((metaIn.play as Record<string, unknown>).panelId),
      }
    : undefined;

  return {
    schemaVersion: 1,
    kind,
    meta: {
      name,
      slug,
      difficulty,
      tags: asStringArray(metaIn.tags),
      category: asString(metaIn.category, 'batch-processing') || 'batch-processing',
      play: play?.domainId && play?.panelId ? play : undefined,
    },
    brief: {
      description,
      problemStatement: {
        overview: asString(ps.overview) || undefined,
        symptoms: Array.isArray(ps.symptoms)
          ? asStringArray(ps.symptoms)
          : (asString(ps.symptoms) ? [asString(ps.symptoms)] : []),
        yourTask: asString(ps.yourTask) || undefined,
        yourTaskSteps: asStringArray(ps.yourTaskSteps),
        hints: Array.isArray(ps.hints)
          ? asStringArray(ps.hints)
          : (asString(ps.hints) ? [asString(ps.hints)] : []),
        inputSchema: Array.isArray(ps.inputSchema)
          ? (ps.inputSchema as Array<{ column: string; type: string }>)
          : undefined,
        expectedOutput: Array.isArray(ps.expectedOutput)
          ? (ps.expectedOutput as Array<{ column: string; description: string }>)
          : undefined,
      },
    },
    kindSpec: normalizeKindSpec(o.kindSpec, kind),
    data,
    transform,
    platform,
    evalCollection,
  };
}

function extractSparkShapeContract(text: string): SparkShapeContract | null {
  const tagged =
    parseJsonObject(extractTag(text, 'spark_shape_contract'))
    || parseJsonObject(extractTag(text, 'shape_contract'));
  if (tagged) return normalizeSparkShapeContract(tagged);

  // Fallback: whole message is JSON
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return normalizeSparkShapeContract(parseJsonObject(trimmed));
  }
  return null;
}

function validateSparkShapeContract(contract: SparkShapeContract | null): string[] {
  const missing: string[] = [];
  if (!contract) return ['shape contract missing or invalid'];
  if (!contract.meta.name) missing.push('meta.name');
  if (!contract.meta.slug) missing.push('meta.slug');
  if (!contract.brief.description.trim()) missing.push('brief.description');
  if (!contract.data?.schema?.length) missing.push('data.schema');
  if (!contract.transform?.validationRules?.length) missing.push('transform.validationRules');
  if (!contract.transform?.aggregations?.length) missing.push('transform.aggregations');
  if (!contract.platform?.starterFileName) missing.push('platform.starterFileName');
  if (!contract.evalCollection?.columns?.length) missing.push('evalCollection.columns');
  if (contract.kind === 'debug' && !contract.kindSpec.rootCause?.trim()) {
    missing.push('kindSpec.rootCause (required for debug)');
  }
  return missing;
}

module.exports = {
  SHAPE_CONTRACT_HINT,
  extractSparkShapeContract,
  normalizeSparkShapeContract,
  validateSparkShapeContract,
  extractTag,
};
