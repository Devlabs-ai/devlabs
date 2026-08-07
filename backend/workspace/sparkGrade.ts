'use strict';

/**
 * Grade candidate results JSON against challenge eval/solution.json.
 *
 * Contract (devlabs.eval.v1):
 *   - Author:   challenges/<id>/eval/solution.json  (keys + columns + rows)
 *   - Candidate: workspaces/.../results/<jobId>/solution.json  ({ "rows": [...] })
 *
 * Schema always comes from the author's solution.json.
 */

const { getObjectStore, normalizeKey } = require('./objectStore');

export interface GradeResult {
  passed: boolean;
  kind: 'submission' | 'preview';
  summary: string;
  checks: Array<{ id: string; label: string; passed: boolean; detail?: string }>;
  candidateKey: string;
  solutionKey: string;
  gradedAt: number;
}

type ColDef = {
  name: string;
  type: string;
  role: 'key' | 'value';
  atol: number | null;
};

type Schema = { keys: string[]; columns: ColDef[] };

function s3aToKey(s3aOrKey: string): string {
  const raw = String(s3aOrKey || '').trim();
  if (!raw) return '';
  const m = raw.match(/^s3a:\/\/[^/]+\/(.+)$/);
  return normalizeKey(m ? m[1] : raw.replace(/^\/+/, ''));
}

function parseSchema(data: Record<string, unknown>): { schema: Schema | null; error?: string } {
  const rawCols = data.columns;
  if (!Array.isArray(rawCols) || rawCols.length === 0) {
    return { schema: null, error: "solution.json must define non-empty 'columns'" };
  }

  const cols: ColDef[] = [];
  if (typeof rawCols[0] === 'object' && rawCols[0] !== null) {
    for (const c of rawCols as Array<Record<string, unknown>>) {
      const name = String(c.name || '');
      if (!name) return { schema: null, error: "each column object needs 'name'" };
      const typ = String(c.type || 'string').toLowerCase();
      const atol =
        c.atol != null
          ? Number(c.atol)
          : (typ === 'float' || typ === 'double' || typ === 'number' ? 1e-4 : null);
      cols.push({
        name,
        type: typ,
        role: (String(c.role || '').toLowerCase() === 'key' ? 'key' : 'value'),
        atol: Number.isFinite(atol as number) ? (atol as number) : null,
      });
    }
  } else {
    const types = (data.types && typeof data.types === 'object')
      ? (data.types as Record<string, string>)
      : {};
    for (const name of rawCols as string[]) {
      const typ = String(types[name] || 'string').toLowerCase();
      cols.push({
        name: String(name),
        type: typ,
        role: 'value',
        atol: typ === 'float' || typ === 'double' || typ === 'number' ? 1e-4 : null,
      });
    }
  }

  let keys = Array.isArray(data.keys) ? (data.keys as string[]).map(String) : [];
  if (!keys.length) {
    keys = cols.filter((c) => c.role === 'key').map((c) => c.name);
  }
  if (!keys.length) {
    keys = [];
    for (const c of cols) {
      if (c.type === 'float' || c.type === 'double' || c.type === 'number') break;
      keys.push(c.name);
    }
    if (!keys.length) keys = [cols[0].name];
  }

  const keySet = new Set(keys);
  for (const k of keys) {
    if (!cols.some((c) => c.name === k)) {
      return { schema: null, error: `key '${k}' not listed in columns` };
    }
  }
  for (const c of cols) {
    c.role = keySet.has(c.name) ? 'key' : 'value';
  }

  return { schema: { keys, columns: cols } };
}

function coerce(value: unknown, typ: string): unknown {
  const t = (typ || 'string').toLowerCase();
  if (value == null) throw new Error('null not allowed');
  if (t === 'string' || t === 'str') return String(value);
  if (t === 'int' || t === 'integer' || t === 'long') return Number.parseInt(String(value), 10);
  if (t === 'float' || t === 'double' || t === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`invalid float: ${value}`);
    return Math.round(n * 1e6) / 1e6;
  }
  if (t === 'bool' || t === 'boolean') {
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    if (['1', 'true', 't', 'yes'].includes(s)) return true;
    if (['0', 'false', 'f', 'no'].includes(s)) return false;
    throw new Error(`invalid bool: ${value}`);
  }
  return String(value);
}

function normalizeRows(
  rows: unknown[],
  schema: Schema,
): { rows: Array<Record<string, unknown>> | null; error?: string } {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (!r || typeof r !== 'object') {
      return { rows: null, error: `row ${i} is not an object` };
    }
    const rec = r as Record<string, unknown>;
    const norm: Record<string, unknown> = {};
    for (const c of schema.columns) {
      if (!(c.name in rec)) {
        return { rows: null, error: `row ${i} missing column '${c.name}'` };
      }
      try {
        norm[c.name] = coerce(rec[c.name], c.type);
      } catch (e: unknown) {
        return { rows: null, error: `row ${i} column '${c.name}': ${(e as Error).message}` };
      }
    }
    out.push(norm);
  }
  out.sort((a, b) => {
    for (const k of schema.keys) {
      const av = a[k];
      const bv = b[k];
      if (av === bv) continue;
      if (av == null) return -1;
      if (bv == null) return 1;
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });
  return { rows: out };
}

function rowKey(row: Record<string, unknown>, keys: string[]): string {
  return JSON.stringify(keys.map((k) => row[k]));
}

function valuesEqual(sv: unknown, cv: unknown, col: ColDef): boolean {
  const typ = col.type;
  if (typ === 'float' || typ === 'double' || typ === 'number') {
    const atol = col.atol ?? 1e-4;
    return Math.abs(Number(sv) - Number(cv)) <= atol;
  }
  return sv === cv;
}

function extractRows(data: unknown): { rows: unknown[] | null; error?: string } {
  if (Array.isArray(data)) return { rows: data };
  if (data && typeof data === 'object') {
    const rows = (data as Record<string, unknown>).rows;
    if (Array.isArray(rows)) return { rows };
    return { rows: null, error: "JSON must be { rows: [...] } or a row array" };
  }
  return { rows: null, error: 'JSON root must be an object or array' };
}

async function gradeOutputAgainstSolution(opts: {
  /** Candidate result JSON s3a path (…/results/<jobId>/solution.json) */
  candidateOutputS3a: string;
  /** Author eval/solution.json s3a path */
  evalSolutionS3a: string;
  kind: 'submission' | 'preview';
  sparkSucceeded: boolean;
}): Promise<GradeResult> {
  const gradedAt = Date.now();
  const candidateKey = s3aToKey(opts.candidateOutputS3a);
  const solutionKey = s3aToKey(opts.evalSolutionS3a);
  const checks: GradeResult['checks'] = [];

  if (!opts.sparkSucceeded) {
    return {
      passed: false,
      kind: opts.kind,
      summary: 'Spark application did not succeed',
      checks: [{ id: 'spark_status', label: 'Spark application succeeded', passed: false }],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }
  checks.push({ id: 'spark_status', label: 'Spark application succeeded', passed: true });

  if (!solutionKey) {
    return {
      passed: false,
      kind: opts.kind,
      summary: 'Challenge eval/solution.json path is not configured',
      checks: [
        ...checks,
        { id: 'solution_configured', label: 'eval/solution.json configured', passed: false },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }

  const store = getObjectStore();
  const solutionBuf = await store.getObject(solutionKey);
  if (!solutionBuf) {
    return {
      passed: false,
      kind: opts.kind,
      summary: `Author eval solution missing: ${solutionKey}`,
      checks: [
        ...checks,
        {
          id: 'solution_present',
          label: 'eval/solution.json present in MinIO',
          passed: false,
          detail: solutionKey,
        },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }
  checks.push({ id: 'solution_present', label: 'eval/solution.json present', passed: true });

  let solutionData: Record<string, unknown>;
  try {
    solutionData = JSON.parse(solutionBuf.toString('utf8'));
  } catch {
    return {
      passed: false,
      kind: opts.kind,
      summary: 'eval/solution.json is not valid JSON',
      checks: [
        ...checks,
        { id: 'solution_json', label: 'eval/solution.json is valid JSON', passed: false },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }
  checks.push({ id: 'solution_json', label: 'eval/solution.json is valid JSON', passed: true });

  const { schema, error: schemaErr } = parseSchema(solutionData);
  if (!schema) {
    return {
      passed: false,
      kind: opts.kind,
      summary: schemaErr || 'Invalid solution schema',
      checks: [
        ...checks,
        { id: 'solution_schema', label: 'solution.json schema readable', passed: false, detail: schemaErr },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }
  checks.push({
    id: 'solution_schema',
    label: 'solution.json schema readable',
    passed: true,
    detail: `keys=${schema.keys.join(',')}; cols=${schema.columns.map((c) => c.name).join(',')}`,
  });

  const solExtract = extractRows(solutionData);
  if (!solExtract.rows) {
    return {
      passed: false,
      kind: opts.kind,
      summary: solExtract.error || 'No rows in solution.json',
      checks: [
        ...checks,
        { id: 'solution_rows', label: 'solution.json rows present', passed: false, detail: solExtract.error },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }
  const solNorm = normalizeRows(solExtract.rows, schema);
  if (!solNorm.rows) {
    return {
      passed: false,
      kind: opts.kind,
      summary: solNorm.error || 'Failed to normalize solution rows',
      checks: [
        ...checks,
        { id: 'solution_rows', label: 'solution.json rows readable', passed: false, detail: solNorm.error },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }
  checks.push({
    id: 'solution_rows',
    label: 'solution.json rows readable',
    passed: true,
    detail: `${solNorm.rows.length} rows`,
  });

  if (!candidateKey) {
    return {
      passed: false,
      kind: opts.kind,
      summary: 'Candidate OUTPUT_PATH not configured',
      checks: [
        ...checks,
        { id: 'candidate_configured', label: 'Candidate OUTPUT_PATH configured', passed: false },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }

  const candBuf = await store.getObject(candidateKey);
  if (!candBuf) {
    return {
      passed: false,
      kind: opts.kind,
      summary:
        `Spark succeeded but did not write OUTPUT_PATH `
        + `(expected results/.../solution.json with {"rows":[...]}). `
        + `Call write_result_json(spark, rows, OUTPUT_PATH) before spark.stop().`,
      checks: [
        ...checks,
        {
          id: 'candidate_present',
          label: 'Candidate wrote results/.../solution.json',
          passed: false,
          detail: candidateKey,
        },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }
  checks.push({
    id: 'candidate_present',
    label: 'Candidate wrote results/.../solution.json',
    passed: true,
  });

  let candData: unknown;
  try {
    candData = JSON.parse(candBuf.toString('utf8'));
  } catch {
    return {
      passed: false,
      kind: opts.kind,
      summary: 'Candidate result is not valid JSON',
      checks: [
        ...checks,
        { id: 'candidate_json', label: 'Candidate JSON is valid', passed: false },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }
  checks.push({ id: 'candidate_json', label: 'Candidate JSON is valid', passed: true });

  const candExtract = extractRows(candData);
  if (!candExtract.rows) {
    return {
      passed: false,
      kind: opts.kind,
      summary: candExtract.error || 'No rows in candidate JSON',
      checks: [
        ...checks,
        { id: 'candidate_rows', label: 'Candidate rows present', passed: false, detail: candExtract.error },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }
  const candNorm = normalizeRows(candExtract.rows, schema);
  if (!candNorm.rows) {
    return {
      passed: false,
      kind: opts.kind,
      summary: candNorm.error || 'Failed to normalize candidate rows',
      checks: [
        ...checks,
        { id: 'candidate_rows', label: 'Candidate rows match schema', passed: false, detail: candNorm.error },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }
  checks.push({
    id: 'candidate_rows',
    label: 'Candidate rows match schema',
    passed: true,
    detail: `${candNorm.rows.length} rows`,
  });

  if (candNorm.rows.length !== solNorm.rows.length) {
    checks.push({
      id: 'row_count',
      label: 'Row counts match',
      passed: false,
      detail: `candidate=${candNorm.rows.length} solution=${solNorm.rows.length}`,
    });
  } else {
    checks.push({
      id: 'row_count',
      label: 'Row counts match',
      passed: true,
      detail: String(candNorm.rows.length),
    });
  }

  const solMap = new Map(solNorm.rows.map((r) => [rowKey(r, schema.keys), r]));
  const candMap = new Map(candNorm.rows.map((r) => [rowKey(r, schema.keys), r]));
  let missing = 0;
  let extra = 0;
  for (const k of solMap.keys()) if (!candMap.has(k)) missing += 1;
  for (const k of candMap.keys()) if (!solMap.has(k)) extra += 1;

  if (missing || extra) {
    checks.push({
      id: 'keys_match',
      label: 'Row keys match solution.json',
      passed: false,
      detail: `missing=${missing} extra=${extra}`,
    });
  } else {
    checks.push({ id: 'keys_match', label: 'Row keys match solution.json', passed: true });
    const valueCols = schema.columns.filter((c) => c.role === 'value');
    const diffs: string[] = [];
    for (const [k, srow] of solMap) {
      const crow = candMap.get(k)!;
      for (const c of valueCols) {
        if (!valuesEqual(srow[c.name], crow[c.name], c)) {
          diffs.push(`${k}:${c.name}`);
        }
      }
    }
    if (diffs.length) {
      checks.push({
        id: 'values_match',
        label: 'Values match solution.json',
        passed: false,
        detail: `${diffs.length} cell mismatch(es); e.g. ${diffs.slice(0, 5).join(', ')}`,
      });
    } else {
      checks.push({ id: 'values_match', label: 'Values match solution.json', passed: true });
    }
  }

  const passed = checks.every((c) => c.passed);
  return {
    passed,
    kind: opts.kind,
    summary: passed
      ? 'Passed — result JSON matches eval/solution.json'
      : 'Failed — result JSON differs from eval/solution.json',
    checks,
    candidateKey,
    solutionKey,
    gradedAt,
  };
}

/** @deprecated alias */
async function gradeOutputAgainstResults(opts: {
  candidateOutputS3a: string;
  resultsS3a: string;
  kind: 'submission' | 'preview';
  sparkSucceeded: boolean;
}): Promise<GradeResult> {
  return gradeOutputAgainstSolution({
    candidateOutputS3a: opts.candidateOutputS3a,
    evalSolutionS3a: opts.resultsS3a,
    kind: opts.kind,
    sparkSucceeded: opts.sparkSucceeded,
  });
}

module.exports = {
  gradeOutputAgainstSolution,
  gradeOutputAgainstResults,
  s3aToKey,
};
