'use strict';

// Static handbook rows (dos / donts / conf) for the build pipeline.
// Seeded from imageCatalog; updated by ops — not written during builds.

const crypto = require('crypto');
const pool = require('../db/pool');

function sigOf(category, stack, title) {
  return crypto
    .createHash('sha256')
    .update(`${category}|${stack || ''}|${title}`)
    .digest('hex');
}

const DRAFT_CATEGORY_STACKS = {
  database: ['postgres', 'mysql', 'mariadb', 'mongodb'],
  caching: ['redis'],
  messaging: ['apache-kafka', 'rabbitmq'],
  networking: ['nginx'],
  observability: ['prometheus', 'grafana'],
};

function categorySlug(category) {
  if (!category || typeof category !== 'string') return null;
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || null;
}

function resolveCategories(draft) {
  const cats = new Set(['global']);
  const raw = draft?.category
    || draft?.sandboxSpec?.category
    || draft?.sandboxSpec?.brief?.category;
  const slug = categorySlug(raw);
  if (slug) {
    cats.add(slug);
    const stacks = DRAFT_CATEGORY_STACKS[slug];
    if (stacks) stacks.forEach((s) => cats.add(s));
  }
  const services = draft?.sandboxSpec?.services || [];
  if (Array.isArray(services)) {
    for (const svc of services) {
      const s = String(svc).toLowerCase();
      if (s.includes('postgres')) cats.add('postgres');
      if (s.includes('kafka')) cats.add('apache-kafka');
      if (s.includes('redis')) cats.add('redis');
      if (s.includes('mongo')) cats.add('mongodb');
      if (s.includes('mysql') || s.includes('mariadb')) cats.add('mysql');
      if (s.includes('nginx')) cats.add('nginx');
    }
  }
  return [...cats];
}

async function upsert({
  category,
  stack = null,
  serviceRole = null,
  title,
  dos = [],
  donts = [],
  conf = {},
  priority = 0,
  active = true,
}) {
  const signature = sigOf(category, stack, title);
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO specialists
       (signature, category, stack, service_role, title, dos, donts, conf,
        priority, active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
     ON CONFLICT (signature) DO UPDATE SET
       dos = EXCLUDED.dos,
       donts = EXCLUDED.donts,
       conf = EXCLUDED.conf,
       priority = EXCLUDED.priority,
       active = EXCLUDED.active,
       updated_at = EXCLUDED.updated_at
     RETURNING id`,
    [
      signature,
      category,
      stack,
      serviceRole,
      title,
      JSON.stringify(dos),
      JSON.stringify(donts),
      JSON.stringify(conf),
      priority,
      active,
      now,
    ],
  );
  return rows[0]?.id || null;
}

async function existsBySignature(signature) {
  const { rows } = await pool.query(
    `SELECT 1 FROM specialists WHERE signature = $1 LIMIT 1`,
    [signature],
  );
  return rows.length > 0;
}

async function removeByCategory(category) {
  if (!category) return 0;
  const mapped = category === 'docker-images' ? 'global' : category;
  const { rowCount } = await pool.query(
    `DELETE FROM specialists WHERE category = $1 OR stack = $1`,
    [mapped],
  );
  return rowCount || 0;
}

async function count() {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM specialists`);
  return rows[0]?.n || 0;
}

async function listPaginated({ page = 1, limit = 20, category = null, activeOnly = true } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const where = [];
  const params = [];
  let n = 1;

  if (activeOnly) {
    where.push('active = true');
  }
  if (category) {
    where.push(`(category = $${n} OR stack = $${n})`);
    params.push(category);
    n += 1;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM specialists ${whereSql}`,
    params,
  );
  const total = countRes.rows[0]?.n || 0;

  const { rows } = await pool.query(
    `SELECT id, category, stack, service_role, title, dos, donts, conf, priority,
            active, created_at, updated_at
       FROM specialists
       ${whereSql}
       ORDER BY priority DESC, updated_at DESC
       LIMIT $${n} OFFSET $${n + 1}`,
    [...params, safeLimit, offset],
  );

  return {
    items: rows.map((r) => ({
      ...rowToEntry(r),
      active: r.active,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    })),
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

async function listByCategories(categories) {
  if (!categories.length) return [];
  const { rows } = await pool.query(
    `SELECT id, category, stack, service_role, title, dos, donts, conf, priority
       FROM specialists
      WHERE active = true
        AND (category = ANY($1::text[]) OR stack = ANY($1::text[]))
      ORDER BY priority DESC, updated_at DESC`,
    [categories],
  );
  return rows.map(rowToEntry);
}

async function buildBrief({ draft }) {
  const categories = resolveCategories(draft);
  const entries = await listByCategories(categories);
  return {
    category: draft?.category || draft?.sandboxSpec?.category || null,
    matchedCategories: categories,
    entries: entries.map((e) => ({
      category: e.category,
      stack: e.stack,
      serviceRole: e.serviceRole,
      title: e.title,
      dos: e.dos,
      donts: e.donts,
      conf: e.conf,
    })),
  };
}

function rowToEntry(r) {
  return {
    id: r.id,
    category: r.category,
    stack: r.stack,
    serviceRole: r.service_role,
    title: r.title,
    dos: r.dos || [],
    donts: r.donts || [],
    conf: r.conf || {},
    priority: r.priority,
  };
}

module.exports = {
  upsert,
  existsBySignature,
  sigOf,
  removeByCategory,
  count,
  listPaginated,
  buildBrief,
  resolveCategories,
  categorySlug,
};
