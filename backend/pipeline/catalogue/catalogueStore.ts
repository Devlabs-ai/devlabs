'use strict';

import type { CatalogueEntry, ObservableSpec } from '../../types/domain';

const pool = require('../../db/pool');

interface CatalogueDbRow {
  id?: number;
  category: string;
  image?: string | null;
  image_hints?: string[] | null;
  port?: number | null;
  dos?: string[] | null;
  donts?: string[] | null;
  conf?: Record<string, unknown> | null;
  default_limits?: Record<string, string> | null;
  handbook_text?: string | null;
  metric_format?: string | null;
  observables?: ObservableSpec[] | null;
  created_at?: number;
  updated_at?: number;
}

/** In-memory cache loaded after seed / boot. category -> row */
let cacheByCategory = new Map<string, CatalogueEntry>();

function rowToEntry(row: CatalogueDbRow): CatalogueEntry | null {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    image: row.image,
    imageHints: row.image_hints || [],
    port: row.port,
    dos: row.dos || [],
    donts: row.donts || [],
    conf: row.conf || {},
    defaultLimits: row.default_limits || null,
    handbookText: row.handbook_text,
    metricFormat: row.metric_format,
    observables: row.observables || [],
  };
}

function rowParams(row: CatalogueDbRow, now: number): unknown[] {
  return [
    row.category,
    row.image,
    JSON.stringify(row.image_hints || []),
    row.port,
    JSON.stringify(row.dos || []),
    JSON.stringify(row.donts || []),
    JSON.stringify(row.conf || {}),
    row.default_limits ? JSON.stringify(row.default_limits) : null,
    row.handbook_text,
    row.metric_format,
    JSON.stringify(row.observables || []),
    now,
  ];
}

/** Insert a row only when category is absent — never overwrites existing data. */
async function insertIfAbsent(row: CatalogueDbRow): Promise<CatalogueEntry | null> {
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO catalogue (
       category, image, image_hints, port, dos, donts, conf,
       default_limits, handbook_text, metric_format, observables,
       created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
     ON CONFLICT (category) DO NOTHING
     RETURNING *`,
    rowParams(row, now),
  );
  return rows[0] ? rowToEntry(rows[0]) : null;
}

async function upsert(row: CatalogueDbRow): Promise<CatalogueEntry> {
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO catalogue (
       category, image, image_hints, port, dos, donts, conf,
       default_limits, handbook_text, metric_format, observables,
       created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
     ON CONFLICT (category) DO UPDATE SET
       image = EXCLUDED.image,
       image_hints = EXCLUDED.image_hints,
       port = EXCLUDED.port,
       dos = EXCLUDED.dos,
       donts = EXCLUDED.donts,
       conf = EXCLUDED.conf,
       default_limits = EXCLUDED.default_limits,
       handbook_text = EXCLUDED.handbook_text,
       metric_format = EXCLUDED.metric_format,
       observables = EXCLUDED.observables,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    rowParams(row, now),
  );
  return rowToEntry(rows[0]) as CatalogueEntry;
}

async function count(): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM catalogue`);
  return rows[0]?.n || 0;
}

async function loadCache(): Promise<number> {
  const { rows } = await pool.query(`SELECT * FROM catalogue ORDER BY category`);
  cacheByCategory = new Map(rows.map((r: CatalogueDbRow) => [r.category, rowToEntry(r) as CatalogueEntry]));
  return cacheByCategory.size;
}

function getCached(category: string): CatalogueEntry | null {
  return cacheByCategory.get(category) || null;
}

function getCachedByCategories(categories: string[]): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
  const seen = new Set<string>();
  for (const cat of categories) {
    const key = String(cat || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const entry = getCached(key);
    if (entry) out.push(entry);
  }
  return out;
}

function listCachedCategoryKeys(): string[] {
  return [...cacheByCategory.keys()];
}

async function listAll(): Promise<CatalogueEntry[]> {
  const { rows } = await pool.query(`SELECT * FROM catalogue ORDER BY category`);
  return rows.map(rowToEntry).filter(Boolean) as CatalogueEntry[];
}

async function listPaginated({
  page = 1,
  limit = 20,
  category = null,
}: {
  page?: number;
  limit?: number;
  category?: string | null;
} = {}): Promise<{
  items: Array<CatalogueEntry & { createdAt: number; updatedAt: number }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const safeLimit = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 50);
  const safePage = Math.max(parseInt(String(page), 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const params: unknown[] = [];
  let whereSql = '';
  if (category) {
    whereSql = 'WHERE category = $1';
    params.push(category);
  }

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM catalogue ${whereSql}`,
    params,
  );
  const total = countRes.rows[0]?.n || 0;

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const { rows } = await pool.query(
    `SELECT * FROM catalogue ${whereSql}
     ORDER BY category ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, safeLimit, offset],
  );

  return {
    items: rows.map((r: CatalogueDbRow & { created_at: number; updated_at: number }) => ({
      ...rowToEntry(r),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    })),
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

module.exports = {
  insertIfAbsent,
  upsert,
  count,
  loadCache,
  getCached,
  getCachedByCategories,
  listCachedCategoryKeys,
  listAll,
  listPaginated,
  rowToEntry,
};
