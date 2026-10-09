'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { requireInterviewer } = require('../auth/middleware');
const { sanitizeOwner } = require('../workspace/workspaceStore');
const pool = require('../db/pool');
const { isAvatarId, parseTzOffset, activityFor } = require('../profile/activity');

const router = express.Router();

function userId(req: ExpressRequest): string {
  const user = req.user as { sub?: string; userId?: string; id?: string } | undefined;
  return user?.sub || user?.userId || user?.id || '';
}

/** GET /api/profile/me?tz=<getTimezoneOffset minutes> — avatar and activity for the signed-in user. */
router.get('/me', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const id = userId(req);
    const { rows } = await pool.query(`SELECT avatar FROM users WHERE id = $1`, [id]);
    const tz = parseTzOffset((req.query as Record<string, unknown>).tz);
    res.json({
      avatar: (rows[0] as { avatar?: string | null } | undefined)?.avatar ?? null,
      activity: await activityFor(sanitizeOwner(id), tz),
    });
  } catch (e) {
    next(e);
  }
});

/** PUT /api/profile/avatar { avatar: <preset id> | null } */
router.put('/avatar', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const avatar = (req.body as { avatar?: unknown } | undefined)?.avatar ?? null;
    if (avatar !== null && !isAvatarId(avatar)) return res.status(400).json({ error: 'invalid_avatar' });
    await pool.query(`UPDATE users SET avatar = $2 WHERE id = $1`, [userId(req), avatar]);
    res.json({ avatar });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
