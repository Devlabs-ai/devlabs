'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { requireInterviewer, requireAdmin } = require('../auth/middleware');
const { sanitizeOwner } = require('../workspace/workspaceStore');
const pool = require('../db/pool');

const router = express.Router();

const ITEM_KINDS = new Set(['major', 'minor']);
const ITEM_ID_RE = /^[a-z0-9-]{1,80}$/;

function ownerKey(req: ExpressRequest): string | null {
  const user = req.user as { sub?: string; id?: string } | undefined;
  const userId = sanitizeOwner(user?.sub || user?.id || '');
  return userId && userId !== 'anonymous' ? userId : null;
}

function parseItem(body: unknown): { kind: string; itemId: string } | null {
  const b = (body || {}) as { kind?: unknown; itemId?: unknown };
  const kind = String(b.kind || '');
  const itemId = String(b.itemId || '');
  if (!ITEM_KINDS.has(kind) || !ITEM_ID_RE.test(itemId)) return null;
  return { kind, itemId };
}

/** GET /api/notify — items the caller asked to be notified about, as "kind:id". */
router.get('/', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const userId = ownerKey(req);
    if (!userId) return res.json({ items: [] });
    const { rows } = await pool.query(
      'SELECT item_kind, item_id FROM notify_requests WHERE user_id = $1',
      [userId],
    );
    res.json({
      items: (rows as Array<{ item_kind: string; item_id: string }>).map((r) => `${r.item_kind}:${r.item_id}`),
    });
  } catch (e) {
    next(e);
  }
});

/** POST /api/notify { kind, itemId } — sign up for a notification. */
router.post('/', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const userId = ownerKey(req);
    const item = parseItem(req.body);
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });
    if (!item) return res.status(400).json({ error: 'kind must be major or minor, with a valid itemId' });
    await pool.query(
      `INSERT INTO notify_requests (user_id, item_kind, item_id, email, created_at)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, item_kind, item_id) DO NOTHING`,
      [userId, item.kind, item.itemId, req.user?.email || null, Date.now()],
    );
    res.json({ subscribed: true });
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/notify { kind, itemId } — cancel a notification. */
router.delete('/', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const userId = ownerKey(req);
    const item = parseItem(req.body);
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });
    if (!item) return res.status(400).json({ error: 'kind must be major or minor, with a valid itemId' });
    await pool.query(
      'DELETE FROM notify_requests WHERE user_id = $1 AND item_kind = $2 AND item_id = $3',
      [userId, item.kind, item.itemId],
    );
    res.json({ subscribed: false });
  } catch (e) {
    next(e);
  }
});

/** GET /api/notify/summary — admin: who is waiting on each item. */
router.get('/summary', requireAdmin, async (_req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.item_kind, n.item_id, n.user_id, COALESCE(n.email, u.email) AS email, n.created_at
         FROM notify_requests n
         LEFT JOIN users u ON regexp_replace(u.id, '[^a-zA-Z0-9_-]', '_', 'g') = n.user_id
        ORDER BY n.item_kind, n.item_id, n.created_at`,
    );
    const items = new Map<string, { kind: string; itemId: string; users: Array<{ email: string | null; at: number }> }>();
    for (const r of rows as Array<{ item_kind: string; item_id: string; email: string | null; created_at: string | number }>) {
      const key = `${r.item_kind}:${r.item_id}`;
      if (!items.has(key)) items.set(key, { kind: r.item_kind, itemId: r.item_id, users: [] });
      items.get(key)!.users.push({ email: r.email, at: Number(r.created_at) });
    }
    res.json({
      items: Array.from(items.values()).map((i) => ({ ...i, count: i.users.length })),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
