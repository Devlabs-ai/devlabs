'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from '../types/express';

const express = require('express');
const { optionalAuth, requireInterviewer, requireAdmin } = require('../auth/middleware');
const { sanitizeOwner } = require('../workspace/workspaceStore');
const pool = require('../db/pool');
const {
  MONTHLY_PAPERS,
  TOKENS_PER_PAPER,
  DEFAULT_PAPER_ID,
  getMonthlyPaper,
  tokensFor,
} = require('../papers/monthlyPapers');

const router = express.Router();

type Question = { prompt: string; choices: string[]; answer: number; explanation: string };
type Paper = {
  id: string;
  title: string;
  shortTitle: string;
  authors: string;
  venue: string;
  year: number;
  blurb: string;
  href: string;
  questions: Question[];
};
type AttemptRow = { answers: number[]; correct: number; total: number; tokens: number; created_at: string | number };

function ownerKey(req: ExpressRequest): string | null {
  const user = req.user as { sub?: string; id?: string } | undefined;
  const userId = sanitizeOwner(user?.sub || user?.id || '');
  return userId && userId !== 'anonymous' ? userId : null;
}

async function currentPick(): Promise<{ paper: Paper; pickedAt: number | null }> {
  const { rows } = await pool.query('SELECT paper_id, picked_at FROM monthly_paper_picks ORDER BY id DESC LIMIT 1');
  const picked = getMonthlyPaper(rows[0]?.paper_id);
  if (picked) return { paper: picked, pickedAt: Number(rows[0].picked_at) };
  return { paper: getMonthlyPaper(DEFAULT_PAPER_ID), pickedAt: null };
}

async function currentPaper(): Promise<Paper> {
  return (await currentPick()).paper;
}

/** Papers picked before the current one, newest first, each listed once. */
async function earlierPapers(currentId: string, userId: string | null) {
  const { rows } = await pool.query(
    `SELECT p.paper_id, MAX(p.picked_at) AS picked_at, a.correct, a.total, a.tokens
       FROM monthly_paper_picks p
       LEFT JOIN paper_quiz_attempts a ON a.paper_id = p.paper_id AND a.user_id = $2
      WHERE p.paper_id <> $1
      GROUP BY p.paper_id, a.correct, a.total, a.tokens
      ORDER BY MAX(p.picked_at) DESC`,
    [currentId, userId || ''],
  );
  return (rows as { paper_id: string; picked_at: string; correct: number | null; total: number | null; tokens: number | null }[])
    .map((r) => {
      const paper = getMonthlyPaper(r.paper_id) as Paper | null;
      if (!paper) return null;
      const { questions: _questions, ...meta } = publicPaper(paper);
      return {
        ...meta,
        pickedAt: Number(r.picked_at),
        score: r.correct == null ? null : { correct: Number(r.correct), total: Number(r.total), tokens: Number(r.tokens) },
      };
    })
    .filter(Boolean);
}

function publicPaper(paper: Paper) {
  return {
    id: paper.id,
    title: paper.title,
    shortTitle: paper.shortTitle,
    authors: paper.authors,
    venue: paper.venue,
    year: paper.year,
    blurb: paper.blurb,
    href: paper.href,
    questions: paper.questions.map((q) => ({ prompt: q.prompt, choices: q.choices })),
  };
}

function attemptView(paper: Paper, row: AttemptRow) {
  const answers = Array.isArray(row.answers) ? row.answers : [];
  return {
    correct: Number(row.correct),
    total: Number(row.total),
    tokens: Number(row.tokens),
    at: Number(row.created_at),
    review: paper.questions.map((q, i) => ({
      chosen: typeof answers[i] === 'number' ? answers[i] : null,
      answer: q.answer,
      explanation: q.explanation,
    })),
  };
}

async function findAttempt(userId: string, paperId: string): Promise<AttemptRow | null> {
  const { rows } = await pool.query(
    'SELECT answers, correct, total, tokens, created_at FROM paper_quiz_attempts WHERE user_id = $1 AND paper_id = $2',
    [userId, paperId],
  );
  return (rows[0] as AttemptRow | undefined) || null;
}

/**
 * GET /api/monthly-paper — the current paper (no answers), when it was picked,
 * the caller's attempt if any, and earlier picks.
 */
router.get('/', optionalAuth, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const { paper, pickedAt } = await currentPick();
    const userId = ownerKey(req);
    const row = userId ? await findAttempt(userId, paper.id) : null;
    res.json({
      paper: publicPaper(paper),
      pickedAt,
      tokensPerPaper: TOKENS_PER_PAPER,
      attempt: row ? attemptView(paper, row) : null,
      earlier: await earlierPapers(paper.id, userId),
    });
  } catch (e) {
    next(e);
  }
});

/** POST /api/monthly-paper/attempt { paperId, answers: number[] } — one graded attempt per paper. */
router.post('/attempt', requireInterviewer, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const userId = ownerKey(req);
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });
    const body = (req.body || {}) as { paperId?: unknown; answers?: unknown };
    const paper = await currentPaper();
    if (String(body.paperId || '') !== paper.id) {
      return res.status(409).json({ error: 'The paper of the month has changed. Reload to see the new one.' });
    }
    const raw = Array.isArray(body.answers) ? body.answers : [];
    if (raw.length !== paper.questions.length) {
      return res.status(400).json({ error: `Answer all ${paper.questions.length} questions.` });
    }
    const answers = raw.map((a, i) => {
      const n = Number(a);
      return Number.isInteger(n) && n >= 0 && n < paper.questions[i].choices.length ? n : -1;
    });
    if (answers.includes(-1)) return res.status(400).json({ error: 'Every answer must be one of the choices.' });

    const correct = answers.filter((a, i) => a === paper.questions[i].answer).length;
    const total = paper.questions.length;
    const tokens = tokensFor(correct, total);
    const { rows } = await pool.query(
      `INSERT INTO paper_quiz_attempts (user_id, paper_id, answers, correct, total, tokens, created_at)
            VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
       ON CONFLICT (user_id, paper_id) DO NOTHING
       RETURNING answers, correct, total, tokens, created_at`,
      [userId, paper.id, JSON.stringify(answers), correct, total, tokens, Date.now()],
    );
    const row = (rows[0] as AttemptRow | undefined) || (await findAttempt(userId, paper.id));
    if (!rows[0]) {
      return res.status(409).json({ error: 'You already answered this paper.', attempt: row ? attemptView(paper, row) : null });
    }
    res.json({ attempt: attemptView(paper, row as AttemptRow) });
  } catch (e) {
    next(e);
  }
});

/** GET /api/monthly-paper/pool — admin: every paper that can be picked, and the current one. */
router.get('/pool', requireAdmin, async (_req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const paper = await currentPaper();
    res.json({
      currentId: paper.id,
      papers: (MONTHLY_PAPERS as Paper[]).map((p) => ({ id: p.id, title: p.title, shortTitle: p.shortTitle })),
    });
  } catch (e) {
    next(e);
  }
});

/** PUT /api/monthly-paper { paperId } — admin: make a paper the paper of the month. */
router.put('/', requireAdmin, async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
  try {
    const paperId = String(((req.body || {}) as { paperId?: unknown }).paperId || '');
    if (!getMonthlyPaper(paperId)) return res.status(400).json({ error: 'Unknown paper' });
    await pool.query(
      'INSERT INTO monthly_paper_picks (paper_id, picked_by, picked_at) VALUES ($1, $2, $3)',
      [paperId, ownerKey(req), Date.now()],
    );
    res.json({ currentId: paperId });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
