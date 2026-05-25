'use strict';

const pool = require('../../db/pool');

/** In-memory cache loaded after seed / boot. category -> row */
let cacheByCategory = new Map();

function rowToEntry(row) {
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

function rowParams(row, now) {
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
async function insertIfAbsent(row) {
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
  return rows[0] || null;
}

async function upsert(row) {
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
  return rows[0];
}

async function count() {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM catalogue`);
  return rows[0]?.n || 0;
}

async function loadCache() {
  const { rows } = await pool.query(`SELECT * FROM catalogue ORDER BY category`);
  cacheByCategory = new Map(rows.map((r) => [r.category, rowToEntry(r)]));
  return cacheByCategory.size;
}

function getCached(category) {
  return cacheByCategory.get(category) || null;
}

function getCachedByCategories(categories) {
  const out = [];
  const seen = new Set();
  for (const cat of categories) {
    const key = String(cat || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const entry = getCached(key);
    if (entry) out.push(entry);
  }
  return out;
}

function listCachedCategoryKeys() {
  return [...cacheByCategory.keys()];
}

async function listAll() {
  const { rows } = await pool.query(`SELECT * FROM catalogue ORDER BY category`);
  return rows.map(rowToEntry);
}

async function listPaginated({ page = 1, limit = 20, category = null } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const params = [];
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
    items: rows.map((r) => ({
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
