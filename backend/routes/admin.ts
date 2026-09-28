'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { requireAdmin, isAdminUser } = require('../auth/middleware');
const {
  readAdminSettings,
  updateAdminSettings,
} = require('../admin/settings');
const {
  listUsers,
  findUserById,
  setUserStatus,
  setUserRole,
  approveUser,
} = require('../auth/companyStore');
const {
  isUserRole,
  reviewTracksForRole,
  USER_ROLES,
  REVIEW_TRACK_IDS,
} = require('../auth/roles');

const pool = require('../db/pool');

const router = express.Router();

const VALID_STATUSES = new Set(['pending', 'active', 'rejected']);

function publicAdminUser(user: {
  id: string;
  email: string;
  name?: string | null;
  status?: string;
  role?: string;
  reviewTracks?: string[];
  isAdmin?: boolean;
}) {
  const role = user.isAdmin || user.role === 'admin' ? 'admin' : (user.role || 'learner');
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    status: user.status,
    role,
    reviewTracks: role === 'reviewer' ? (user.reviewTracks || []) : [],
    admin: role === 'admin',
  };
}

function parseRoleBody(body: Record<string, unknown> | null | undefined): {
  ok: true;
  role: 'admin' | 'reviewer' | 'learner';
  reviewTracks: string[];
} | { ok: false; error: string } {
  const raw = body || {};
  const roleRaw = raw.role !== undefined ? raw.role : 'learner';
  if (!isUserRole(roleRaw)) {
    return { ok: false, error: `role must be one of: ${USER_ROLES.join(', ')}` };
  }
  const role = roleRaw as 'admin' | 'reviewer' | 'learner';
  const reviewTracks = reviewTracksForRole(role, raw.reviewTracks ?? raw.review_tracks);
  if (role === 'reviewer' && reviewTracks.length === 0) {
    return {
      ok: false,
      error: `reviewer requires at least one track (${REVIEW_TRACK_IDS.join(', ')})`,
    };
  }
  return { ok: true, role, reviewTracks };
}

router.get(
  '/feedback',
  requireAdmin,
  async (_req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const { rows } = await pool.query(
        `SELECT r.id, r.challenge_id, r.body, r.created_at, r.updated_at,
                r.author_id, COALESCE(u.email, r.author_email) AS author_email,
                COALESCE(u.name, r.author_name) AS author_name,
                CASE WHEN u.is_admin OR u.role = 'admin' THEN 'admin' ELSE COALESCE(u.role, 'learner') END AS author_role,
                c.title AS challenge_title, c.category, c.sandbox_type, c.visible_to
           FROM challenge_reviews r
           LEFT JOIN users u ON u.id = r.author_id
           LEFT JOIN challenges c ON c.id = r.challenge_id
          ORDER BY r.created_at DESC`,
      );
      res.json({
        feedback: rows.map((r: Record<string, unknown>) => ({
          id: String(r.id),
          challengeId: String(r.challenge_id),
          challengeTitle: (r.challenge_title as string | null) || null,
          category: (r.category as string | null) || null,
          sandboxType: (r.sandbox_type as string | null) || null,
          visibleTo: (r.visible_to as string | null) || null,
          body: String(r.body || ''),
          createdAt: Number(r.created_at) || 0,
          updatedAt: Number(r.updated_at) || 0,
          authorId: String(r.author_id),
          authorEmail: (r.author_email as string | null) || null,
          authorName: (r.author_name as string | null) || null,
          authorRole: String(r.author_role || 'learner'),
        })),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/settings',
  requireAdmin,
  async (_req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      res.json(await readAdminSettings());
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/settings',
  requireAdmin,
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const body = (req.body || {}) as {
        sparkJobWatcherEnabled?: unknown;
        registrationOpen?: unknown;
      };
      const patch: { sparkJobWatcherEnabled?: boolean; registrationOpen?: boolean } = {};

      if (body.sparkJobWatcherEnabled !== undefined) {
        if (typeof body.sparkJobWatcherEnabled !== 'boolean') {
          res.status(400).json({ error: 'sparkJobWatcherEnabled must be a boolean' });
          return;
        }
        patch.sparkJobWatcherEnabled = body.sparkJobWatcherEnabled;
      }
      if (body.registrationOpen !== undefined) {
        if (typeof body.registrationOpen !== 'boolean') {
          res.status(400).json({ error: 'registrationOpen must be a boolean' });
          return;
        }
        patch.registrationOpen = body.registrationOpen;
      }
      if (
        patch.sparkJobWatcherEnabled === undefined &&
        patch.registrationOpen === undefined
      ) {
        res.status(400).json({
          error: 'Provide sparkJobWatcherEnabled and/or registrationOpen',
        });
        return;
      }

      res.json(await updateAdminSettings(patch));
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/meta',
  requireAdmin,
  (_req: ExpressRequest, res: ExpressResponse) => {
    res.json({
      roles: USER_ROLES,
      reviewTracks: REVIEW_TRACK_IDS,
    });
  },
);

router.get(
  '/users',
  requireAdmin,
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const statusRaw = String(req.query.status || '').trim().toLowerCase();
      const status = statusRaw && VALID_STATUSES.has(statusRaw) ? statusRaw : null;
      if (statusRaw && !status) {
        res.status(400).json({ error: 'status must be pending, active, or rejected' });
        return;
      }
      const users = await listUsers(status);
      res.json({ users: users.map(publicAdminUser) });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/users/:id/approve',
  requireAdmin,
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const user = await findUserById(req.params.id);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const parsed = parseRoleBody(req.body as Record<string, unknown>);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      if (user.status === 'active' && user.role === parsed.role) {
        const sameTracks =
          JSON.stringify(user.reviewTracks || []) === JSON.stringify(parsed.reviewTracks);
        if (sameTracks) {
          res.json({ user: publicAdminUser(user) });
          return;
        }
      }

      const updated = await approveUser({
        userId: user.id,
        role: parsed.role,
        reviewTracks: parsed.reviewTracks,
      });
      res.json({ user: publicAdminUser(updated) });
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/users/:id',
  requireAdmin,
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const user = await findUserById(req.params.id);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const body = (req.body || {}) as Record<string, unknown>;
      const wantsRole = body.role !== undefined || body.reviewTracks !== undefined || body.review_tracks !== undefined;
      if (!wantsRole) {
        res.status(400).json({ error: 'Provide role and/or reviewTracks' });
        return;
      }

      const parsed = parseRoleBody({
        role: body.role !== undefined ? body.role : user.role,
        reviewTracks: body.reviewTracks ?? body.review_tracks ?? user.reviewTracks,
      });
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const updated = await setUserRole({
        userId: user.id,
        role: parsed.role,
        reviewTracks: parsed.reviewTracks,
      });
      res.json({ user: publicAdminUser(updated) });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/users/:id/reject',
  requireAdmin,
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const user = await findUserById(req.params.id);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (user.isAdmin || user.role === 'admin') {
        res.status(400).json({ error: 'Cannot reject an admin user' });
        return;
      }
      const updated = await setUserStatus(user.id, 'rejected');
      res.json({ user: publicAdminUser(updated) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * Re-seed packs → Postgres and refresh the in-memory challenge cache.
 * Auth: admin JWT, or header X-DevLabs-Reload-Token matching CHALLENGE_RELOAD_TOKEN.
 */
router.post(
  '/challenges/reload',
  async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    try {
      const expected = String(process.env.CHALLENGE_RELOAD_TOKEN || 'devlabs-reload').trim();
      const provided = String(req.headers['x-devlabs-reload-token'] || '').trim();
      const tokenOk = Boolean(expected && provided && provided === expected);

      if (!tokenOk) {
        const { verifyToken } = require('../auth/jwt');
        const h = req.headers.authorization || '';
        const bearer = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
        const payload = bearer ? verifyToken(bearer) : null;
        if (!payload || !isAdminUser(payload)) {
          res.status(401).json({
            error: 'admin JWT or X-DevLabs-Reload-Token required',
          });
          return;
        }
        req.user = payload;
      }

      const { seedManualCatalog } = require('../challenges/seedManualCatalog');
      const { loadChallengesFromDB, listChallenges } = require('../challenges/loader');
      await seedManualCatalog();
      await loadChallengesFromDB();
      res.json({
        ok: true,
        count: listChallenges().length,
        reloadedAt: Date.now(),
      });
    } catch (e) {
      next(e);
    }
  },
);

module.exports = router;
