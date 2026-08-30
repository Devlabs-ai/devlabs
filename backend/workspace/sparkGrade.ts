'use strict';

/**
 * Grade candidate Spark output against author expected artifacts.
 *
 * Contracts:
 *   A) JSON (devlabs.eval.v1):
 *      Author:   …/eval/solution.json  (keys + columns + rows)
 *      Candidate: …/results/<jobId>/solution.json  ({ "rows": [...] })
 *   B) Parquet directories:
 *      Author:   …/submit/expected/  (*.parquet of valid rows)
 *      Candidate: …/results/<jobId>/  (*.parquet)
 *      Compare sorted transaction_id sets (+ row counts).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
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

function looksLikeParquetExpected(solutionKey: string): boolean {
  const k = String(solutionKey || '').replace(/\/+$/, '');
  if (!k) return false;
  if (k.endsWith('.json')) return false;
  // Convention: …/expected or …/expected/
  return /(^|\/)expected$/i.test(k) || k.endsWith('/');
}

async function downloadPrefixAll(
  store: ReturnType<typeof getObjectStore>,
  prefix: string,
  destDir: string,
): Promise<string[]> {
  const root = normalizeKey(prefix).replace(/\/?$/, '/');
  const keys = (await store.listKeys(root)).filter(
    (k: string) =>
      !k.endsWith('/')
      && !k.includes('_temporary')
      && !k.includes('.spark-staging')
      && !k.endsWith('.crc'),
  );
  fs.mkdirSync(destDir, { recursive: true });
  const local: string[] = [];
  for (const key of keys) {
    const buf = await store.getObject(key);
    if (!buf) continue;
    const rel = key.startsWith(root) ? key.slice(root.length) : path.basename(key);
    const safeRel = rel
      .split('/')
      .filter((seg: string) => seg && seg !== '.' && seg !== '..')
      .join(path.sep);
    const out = path.join(destDir, safeRel || path.basename(key));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    local.push(out);
  }
  return local;
}

async function gradeWithScript(opts: {
  candidateOutputS3a: string;
  evalSolutionS3a: string;
  gradeScriptS3a: string;
  kind: 'submission' | 'preview';
  sparkSucceeded: boolean;
}): Promise<GradeResult> {
  const gradedAt = Date.now();
  const candidateKey = s3aToKey(opts.candidateOutputS3a);
  const solutionKey = s3aToKey(opts.evalSolutionS3a);
  const scriptKey = s3aToKey(opts.gradeScriptS3a);
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

  if (!scriptKey || !solutionKey || !candidateKey) {
    return {
      passed: false,
      kind: opts.kind,
      summary: 'Grade script / reference / candidate paths not configured',
      checks: [
        ...checks,
        { id: 'paths_configured', label: 'Grade paths configured', passed: false },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }

  const store = getObjectStore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devlabs-grade-script-'));
  try {
    const scriptBuf = await store.getObject(scriptKey);
    if (!scriptBuf) {
      checks.push({
        id: 'grade_script',
        label: 'Challenge grade script present',
        passed: false,
        detail: scriptKey,
      });
      return {
        passed: false,
        kind: opts.kind,
        summary: `Grade script missing: ${scriptKey}`,
        checks,
        candidateKey,
        solutionKey,
        gradedAt,
      };
    }
    const scriptPath = path.join(tmp, 'grade.py');
    fs.writeFileSync(scriptPath, scriptBuf);
    checks.push({ id: 'grade_script', label: 'Challenge grade script present', passed: true });

    const expectedDir = path.join(tmp, 'reference');
    const candidateDir = path.join(tmp, 'candidate');
    const expectedFiles = await downloadPrefixAll(store, solutionKey, expectedDir);
    const candidateFiles = await downloadPrefixAll(store, candidateKey, candidateDir);
    checks.push({
      id: 'reference_present',
      label: 'Reference output present',
      passed: expectedFiles.length > 0,
      detail: `${expectedFiles.length} file(s)`,
    });
    checks.push({
      id: 'candidate_present',
      label: 'Candidate wrote OUTPUT_PATH',
      passed: candidateFiles.length > 0,
      detail: candidateFiles.length
        ? `${candidateFiles.length} file(s)`
        : 'expected results/<jobId>/* via write to OUTPUT_PATH',
    });
    if (!expectedFiles.length || !candidateFiles.length) {
      return {
        passed: false,
        kind: opts.kind,
        summary: 'Missing reference or candidate output',
        checks,
        candidateKey,
        solutionKey,
        gradedAt,
      };
    }

    const py = process.env.PYTHON || process.env.PYTHON3 || 'python3';
    const spawned = spawnSync(
      py,
      [scriptPath, '--candidate', candidateDir, '--reference', expectedDir],
      { encoding: 'utf8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
    );
    if (spawned.error) {
      const msg = (spawned.error as Error).message || String(spawned.error);
      checks.push({
        id: 'grade_runner',
        label: 'Grade script ran',
        passed: false,
        detail: msg,
      });
      return {
        passed: false,
        kind: opts.kind,
        summary: `Failed to run grade script: ${msg}`,
        checks,
        candidateKey,
        solutionKey,
        gradedAt,
      };
    }
    if (spawned.status === 2) {
      const detail = (spawned.stderr || spawned.stdout || 'grade script usage error').trim();
      checks.push({
        id: 'grade_runner',
        label: 'Grade script ran',
        passed: false,
        detail: detail.slice(0, 500),
      });
      return {
        passed: false,
        kind: opts.kind,
        summary: 'Grade script could not read candidate or reference',
        checks,
        candidateKey,
        solutionKey,
        gradedAt,
      };
    }

    let parsed: {
      passed?: boolean;
      summary?: string;
      checks?: Array<{ id?: string; label?: string; passed?: boolean; detail?: string }>;
    };
    try {
      parsed = JSON.parse(String(spawned.stdout || '').trim() || '{}');
    } catch {
      checks.push({
        id: 'grade_runner',
        label: 'Grade script returned JSON',
        passed: false,
        detail: (spawned.stderr || spawned.stdout || '').trim().slice(0, 500),
      });
      return {
        passed: false,
        kind: opts.kind,
        summary: 'Grade script stdout was not valid JSON',
        checks,
        candidateKey,
        solutionKey,
        gradedAt,
      };
    }

    checks.push({ id: 'grade_runner', label: 'Grade script ran', passed: true });
    for (const c of parsed.checks || []) {
      if (!c || typeof c !== 'object') continue;
      checks.push({
        id: String(c.id || 'check'),
        label: String(c.label || c.id || 'check'),
        passed: Boolean(c.passed),
        ...(c.detail ? { detail: String(c.detail) } : {}),
      });
    }

    const passed = checks.every((c) => c.passed);
    return {
      passed,
      kind: opts.kind,
      summary: String(
        parsed.summary
        || (passed ? 'Passed — grade script accepted the output' : 'Failed — grade script rejected the output'),
      ),
      checks,
      candidateKey,
      solutionKey,
      gradedAt,
    };
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function downloadParquetPrefix(store: ReturnType<typeof getObjectStore>, prefix: string, destDir: string): Promise<string[]> {
  const root = normalizeKey(prefix).replace(/\/?$/, '/');
  const keys = (await store.listKeys(root)).filter(
    (k: string) => k.endsWith('.parquet') && !k.includes('_temporary') && !k.includes('.spark-staging'),
  );
  fs.mkdirSync(destDir, { recursive: true });
  const local: string[] = [];
  for (const key of keys) {
    const buf = await store.getObject(key);
    if (!buf) continue;
    // Keep the layout under the prefix: partitionBy writes col=value/ directories
    // that carry column values, and part files repeat names across partitions.
    const rel = key.startsWith(root) ? key.slice(root.length) : path.basename(key);
    const safeRel = rel
      .split('/')
      .filter((seg: string) => seg && seg !== '.' && seg !== '..')
      .join(path.sep);
    const out = path.join(destDir, safeRel || path.basename(key));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    local.push(out);
  }
  return local;
}

const HIVE_DEFAULT_PARTITION = '__HIVE_DEFAULT_PARTITION__';

/**
 * Hive layout stores partition columns in directory names (`col=value/`) and
 * leaves them out of the Parquet files, so they have to be read back from the path.
 */
function partitionsFromPath(filePath: string, rootDir: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const rel = path.relative(rootDir, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return out;
  for (const seg of path.dirname(rel).split(path.sep)) {
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    let name: string;
    let raw: string;
    try {
      name = decodeURIComponent(seg.slice(0, eq));
      raw = decodeURIComponent(seg.slice(eq + 1));
    } catch {
      name = seg.slice(0, eq);
      raw = seg.slice(eq + 1);
    }
    out[name] = raw === HIVE_DEFAULT_PARTITION ? null : raw;
  }
  return out;
}

type ParquetRow = Record<string, unknown>;

async function loadHyparquetReader(): Promise<
  (opts: { file: ArrayBuffer; columns?: string[] }) => Promise<ParquetRow[]>
> {
  const mod = await import('hyparquet');
  return mod.parquetReadObjects as (opts: {
    file: ArrayBuffer;
    columns?: string[];
  }) => Promise<ParquetRow[]>;
}

function normalizeGradeValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    // Stable-ish for decimals coming through hyparquet as floats.
    return Number.isInteger(v) ? String(v) : v.toFixed(6).replace(/\.?0+$/, '');
  }
  if (typeof v === 'bigint') return String(v);
  if (v instanceof Date) {
    const iso = v.toISOString();
    // DATE columns compare as YYYY-MM-DD so a value read from a Hive path matches one read from a file.
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (typeof v === 'object') {
    // Decimal-like / object wrappers
    if (typeof (v as { toString?: () => string }).toString === 'function') {
      const s = String((v as { toString: () => string }).toString());
      if (s !== '[object Object]') return s;
    }
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function parquetRowKey(row: ParquetRow, keys: string[]): string {
  return keys.map((k) => normalizeGradeValue(row[k])).join('\u0001');
}

async function readParquetRows(filePath: string, rootDir?: string): Promise<ParquetRow[]> {
  const read = await loadHyparquetReader();
  const buf = fs.readFileSync(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const rows = await read({ file: ab as ArrayBuffer });
  const partitions = rootDir ? partitionsFromPath(filePath, rootDir) : {};
  const partCols = Object.keys(partitions);
  if (!partCols.length) return rows;
  for (const row of rows) {
    for (const col of partCols) {
      if (row[col] === undefined) row[col] = partitions[col];
    }
  }
  return rows;
}

async function rowsByKeyFromFiles(
  files: string[],
  keys: string[],
  rootDir?: string,
  opts?: { allowDuplicateKeys?: boolean },
): Promise<{ map: Map<string, ParquetRow>; error?: string }> {
  const map = new Map<string, ParquetRow>();
  const allowDup = opts?.allowDuplicateKeys === true;
  for (const f of files) {
    let rows: ParquetRow[];
    try {
      rows = await readParquetRows(f, rootDir);
    } catch (e) {
      return { map, error: `failed reading ${path.basename(f)}: ${String(e)}` };
    }
    for (const row of rows) {
      const k = parquetRowKey(row, keys);
      if (!k || keys.some((col) => row[col] == null || row[col] === '')) {
        return { map, error: `row missing key column(s) ${keys.join(',')} in ${path.basename(f)}` };
      }
      // History joins / exploded outputs often repeat the grade key. Last-write-wins
      // would hide that and can even fluke the correct row — reject explicitly.
      if (!allowDup && map.has(k)) {
        return {
          map,
          error: `duplicate grade key (${keys.join(',')})=${JSON.stringify(keys.map((col) => row[col]))} in ${path.basename(f)} — expected one output row per key`,
        };
      }
      map.set(k, row);
    }
  }
  return { map };
}

function rowsEqual(a: ParquetRow, b: ParquetRow): boolean {
  const cols = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const c of cols) {
    if (normalizeGradeValue(a[c]) !== normalizeGradeValue(b[c])) return false;
  }
  return true;
}

/**
 * Generic per-testcase Parquet row-diff:
 * - expected/ may contain one file per testcase (`<case-id>.parquet`) or parts
 * - candidate/ is the user's OUTPUT_PATH directory (union of all cases)
 * - For each expected file (= testcase), every expected row must exist in candidate
 *   with identical column values (keyed by `keys`, default transaction_id)
 * - Candidate must not contain rows outside the union of all expected keys
 */
async function downloadTestcaseExpectedFiles(
  store: ReturnType<typeof getObjectStore>,
  testcasesPrefixKey: string,
  caseIds: string[],
  destDir: string,
): Promise<Array<{ caseId: string; file: string }>> {
  const root = normalizeKey(testcasesPrefixKey).replace(/\/?$/, '/');
  fs.mkdirSync(destDir, { recursive: true });
  const out: Array<{ caseId: string; file: string }> = [];
  for (const caseId of caseIds) {
    const keys = (await store.listKeys(`${root}${caseId}/expected/`)).filter(
      (k: string) => k.endsWith('.parquet') && !k.includes('_temporary'),
    );
    if (!keys.length) continue;
    const src = keys.sort()[0];
    const buf = await store.getObject(src);
    if (!buf) continue;
    const local = path.join(destDir, `${caseId}.parquet`);
    fs.writeFileSync(local, buf);
    out.push({ caseId, file: local });
  }
  return out;
}

async function gradeParquetAgainstExpected(opts: {
  candidateOutputS3a: string;
  evalSolutionS3a: string;
  kind: 'submission' | 'preview';
  sparkSucceeded: boolean;
  gradeKeys?: string[];
  /** When set, load expected from testcases/<id>/expected/ under evalSolutionS3a */
  gradeCases?: string[];
}): Promise<GradeResult> {
  const gradedAt = Date.now();
  const candidateKey = s3aToKey(opts.candidateOutputS3a);
  const solutionKey = s3aToKey(opts.evalSolutionS3a);
  const keys = opts.gradeKeys?.length ? opts.gradeKeys : ['transaction_id'];
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

  if (!solutionKey || !candidateKey) {
    return {
      passed: false,
      kind: opts.kind,
      summary: 'Parquet expected/candidate paths not configured',
      checks: [
        ...checks,
        { id: 'paths_configured', label: 'Parquet paths configured', passed: false },
      ],
      candidateKey,
      solutionKey,
      gradedAt,
    };
  }

  const store = getObjectStore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devlabs-parquet-grade-'));
  try {
    const expectedDir = path.join(tmp, 'expected');
    const candidateDir = path.join(tmp, 'candidate');
    let expectedFiles: string[] = [];
    if (opts.gradeCases?.length) {
      const downloaded = await downloadTestcaseExpectedFiles(
        store,
        solutionKey,
        opts.gradeCases,
        expectedDir,
      );
      expectedFiles = downloaded.map((d) => d.file).sort();
    } else {
      expectedFiles = (await downloadParquetPrefix(store, solutionKey, expectedDir)).sort();
    }
    const candidateFiles = await downloadParquetPrefix(store, candidateKey, candidateDir);

    checks.push({
      id: 'expected_present',
      label: 'Author expected/ Parquet present',
      passed: expectedFiles.length > 0,
      detail: `${expectedFiles.length} testcase file(s)`,
    });
    checks.push({
      id: 'candidate_present',
      label: 'Candidate wrote OUTPUT_PATH Parquet',
      passed: candidateFiles.length > 0,
      detail: candidateFiles.length
        ? `${candidateFiles.length} file(s)`
        : 'expected results/<jobId>/*.parquet via write.mode("overwrite").parquet(OUTPUT_PATH)',
    });

    if (!expectedFiles.length || !candidateFiles.length) {
      return {
        passed: false,
        kind: opts.kind,
        summary: 'Missing expected or candidate Parquet',
        checks,
        candidateKey,
        solutionKey,
        gradedAt,
      };
    }

    const candLoaded = await rowsByKeyFromFiles(candidateFiles, keys, candidateDir);
    if (candLoaded.error) {
      checks.push({
        id: 'candidate_rows',
        label: 'Candidate Parquet rows readable',
        passed: false,
        detail: candLoaded.error,
      });
      return {
        passed: false,
        kind: opts.kind,
        summary: candLoaded.error,
        checks,
        candidateKey,
        solutionKey,
        gradedAt,
      };
    }
    checks.push({
      id: 'candidate_rows',
      label: 'Candidate Parquet rows readable',
      passed: true,
      detail: `${candLoaded.map.size} rows`,
    });

    const matchedKeys = new Set<string>();
    let casesPassed = 0;
    let casesFailed = 0;

    for (const expFile of expectedFiles) {
      const caseId = path.basename(expFile, '.parquet');
      const expLoaded = await rowsByKeyFromFiles([expFile], keys, expectedDir);
      if (expLoaded.error) {
        casesFailed += 1;
        checks.push({
          id: `case:${caseId}`,
          label: `Testcase ${caseId}`,
          passed: false,
          detail: expLoaded.error,
        });
        continue;
      }

      let missing = 0;
      let mismatched = 0;
      for (const [k, expRow] of expLoaded.map) {
        const candRow = candLoaded.map.get(k);
        if (!candRow) {
          missing += 1;
          continue;
        }
        matchedKeys.add(k);
        if (!rowsEqual(expRow, candRow)) mismatched += 1;
      }

      const ok = missing === 0 && mismatched === 0;
      if (ok) casesPassed += 1;
      else casesFailed += 1;
      checks.push({
        id: `case:${caseId}`,
        label: `Testcase ${caseId}`,
        passed: ok,
        detail: ok
          ? `${expLoaded.map.size} rows match`
          : `rows=${expLoaded.map.size} missing=${missing} value_mismatch=${mismatched}`,
      });
    }

    let extra = 0;
    for (const k of candLoaded.map.keys()) {
      if (!matchedKeys.has(k)) {
        // May still be in some expected file that failed to load; recompute union.
        extra += 1;
      }
    }
    // Recompute extras against union of all successfully loaded expected keys.
    const allExpectedKeys = new Set<string>();
    for (const expFile of expectedFiles) {
      const expLoaded = await rowsByKeyFromFiles([expFile], keys, expectedDir);
      if (expLoaded.error) continue;
      for (const k of expLoaded.map.keys()) allExpectedKeys.add(k);
    }
    extra = 0;
    for (const k of candLoaded.map.keys()) {
      if (!allExpectedKeys.has(k)) extra += 1;
    }

    checks.push({
      id: 'no_extra_rows',
      label: 'No extra rows beyond all expected testcases',
      passed: extra === 0,
      detail: `extra=${extra}`,
    });
    checks.push({
      id: 'all_cases',
      label: 'All testcases passed',
      passed: casesFailed === 0 && casesPassed === expectedFiles.length,
      detail: `passed=${casesPassed} failed=${casesFailed} total=${expectedFiles.length}`,
    });

    const passed = checks.every((c) => c.passed);
    return {
      passed,
      kind: opts.kind,
      summary: passed
        ? `Passed — ${casesPassed} testcase(s) match expected/`
        : `Failed — ${casesFailed} testcase(s) differ from expected/`,
      checks,
      candidateKey,
      solutionKey,
      gradedAt,
    };
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function gradeOutputAgainstSolution(opts: {
  /** Candidate result JSON or Parquet directory s3a path */
  candidateOutputS3a: string;
  /** Author eval/solution.json, expected/ dir, or testcases/ prefix */
  evalSolutionS3a: string;
  kind: 'submission' | 'preview';
  sparkSucceeded: boolean;
  gradeCases?: string[];
  gradeKeys?: string[];
  /** Per-challenge Python grader (s3a). When set, used instead of the built-in row-diff. */
  gradeScript?: string;
}): Promise<GradeResult> {
  if (opts.gradeScript && opts.gradeScript.trim()) {
    return gradeWithScript({
      candidateOutputS3a: opts.candidateOutputS3a,
      evalSolutionS3a: opts.evalSolutionS3a,
      gradeScriptS3a: opts.gradeScript.trim(),
      kind: opts.kind,
      sparkSucceeded: opts.sparkSucceeded,
    });
  }
  const solutionKeyEarly = s3aToKey(opts.evalSolutionS3a);
  const useParquet =
    Boolean(opts.gradeCases?.length)
    || looksLikeParquetExpected(solutionKeyEarly)
    || String(opts.evalSolutionS3a || '').includes('/expected')
    || String(opts.evalSolutionS3a || '').includes('/testcases');
  if (useParquet) {
    return gradeParquetAgainstExpected(opts);
  }

  const gradedAt = Date.now();
  const candidateKey = s3aToKey(opts.candidateOutputS3a);
  const solutionKey = solutionKeyEarly;
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
