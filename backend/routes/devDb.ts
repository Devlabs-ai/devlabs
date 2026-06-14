'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const pool = require('../db/pool');
const { requireInterviewer } = require('../auth/middleware');

const router = express.Router();

function devOnly(_req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void {
  if (process.env.NODE_ENV === 'production' && process.env.DEV_DB_EXPLORER !== 'true') {
    res.status(404).json({ error: 'not found' });
    return;
  }
  next();
}

router.use(devOnly);
router.use(requireInterviewer);

interface ColumnMeta {
  name: string;
  dataType: string;
  udtName: string;
}

interface TableMeta {
  name: string;
  rowCount: number;
}

async function listPublicTables(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY c.relname`,
  );
  return rows.map((r: { name: string }) => r.name);
}

async function assertTable(name: string): Promise<void> {
  const tables = await listPublicTables();
  if (!tables.includes(name)) {
    const err = new Error(`unknown table: ${name}`) as Error & { status?: number };
    err.status = 404;
    throw err;
  }
}

async function getColumns(table: string): Promise<ColumnMeta[]> {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r: { column_name: string; data_type: string; udt_name: string }) => ({
    name: r.column_name,
    dataType: r.data_type,
    udtName: r.udt_name,
  }));
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sanitizeCell(value: unknown, col: ColumnMeta): unknown {
  if (value == null) return null;
  if (col.udtName === 'vector') {
    return '[embedding]';
  }
  if (typeof value === 'object' && value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

router.get('/tables', async (_req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const names = await listPublicTables();
    const tables: TableMeta[] = await Promise.all(
      names.map(async (name) => {
        const { rows } = await pool.query(
          `SELECT COUNT(*)::text AS count FROM ${quoteIdent(name)}`,
        );
        return { name, rowCount: parseInt(rows[0]?.count || '0', 10) };
      }),
    );
    res.json({ tables });
  } catch (e) {
    next(e);
  }
});

router.get('/tables/:table', async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const table = String(req.params.table || '');
    await assertTable(table);

    const columns = await getColumns(table);
    if (!columns.length) {
      res.status(404).json({ error: 'table has no columns' });
      return;
    }

    const page = parsePositiveInt(req.query.page, 1, 10_000);
    const limit = parsePositiveInt(req.query.limit, 50, 100);
    const offset = (page - 1) * limit;

    const sortParam = String(req.query.sort || columns[0].name);
    const sortCol = columns.find((c) => c.name === sortParam) || columns[0];
    const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const q = String(req.query.q || '').trim();
    const textCols = columns.filter((c) =>
      ['text', 'character varying', 'uuid'].includes(c.dataType),
    );

    let whereSql = '';
    const filterParams: unknown[] = [];
    if (q && textCols.length) {
      const parts = textCols.map((c, i) => `${quoteIdent(c.name)}::text ILIKE $${i + 1}`);
      whereSql = `WHERE (${parts.join(' OR ')})`;
      filterParams.push(...textCols.map(() => `%${q}%`));
    }

    const tableIdent = quoteIdent(table);
    const sortIdent = quoteIdent(sortCol.name);

    const countQuery = `SELECT COUNT(*)::int AS total FROM ${tableIdent} ${whereSql}`;
    const { rows: countRows } = await pool.query(countQuery, filterParams);
    const total = (countRows[0] as { total?: number })?.total ?? 0;

    const limitIdx = filterParams.length + 1;
    const offsetIdx = filterParams.length + 2;
    const dataQuery = `
      SELECT * FROM ${tableIdent}
      ${whereSql}
      ORDER BY ${sortIdent} ${order}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const { rows } = await pool.query(dataQuery, [...filterParams, limit, offset]);

    const formattedRows = rows.map((row: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const col of columns) {
        out[col.name] = sanitizeCell(row[col.name], col);
      }
      return out;
    });

    res.json({
      table,
      columns,
      rows: formattedRows,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      sort: sortCol.name,
      order: order.toLowerCase(),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
