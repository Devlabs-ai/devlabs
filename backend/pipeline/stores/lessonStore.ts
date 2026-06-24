'use strict';

/**
 * Persistent store for build-pipeline lessons — structured memories of SPIN/VALIDATE
 * failures and fixes. `failure_summary` is embedded (pgvector) at write time and matched
 * via cosine similarity when repairing after a phase failure.
 */

import type {
  LessonAnchorFailure,
  LessonRecord,
  LessonPhase,
  LessonsBlock,
  RelatedLesson,
} from '../../types/domain';

const pool = require('../../db/pool');
const llm = require('../../llm/client');

const LESSONS_K = 8;
const LESSONS_MAX_DISTANCE = 0.45;
const FAILURE_SUMMARY_MAX = 2000;
const FIX_SUMMARY_MAX = 4000;
const ANCHOR_INPUT_MAX = 8000;
const DIFF_INPUT_MAX = 24000;

function toPgVector(arr: number[]): string {
  return `[${arr.join(',')}]`;
}

function cap(s: unknown, max: number): string | null | undefined {
  if (!s) return s as string | null | undefined;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated]`;
}

const DISTILL_FAILURE_SYSTEM = `You compress build pipeline failure signals into 2-3 lines for a searchable lesson database.

Rules:
- Output plain text only (no markdown, no bullet prefixes).
- Exactly 2-3 lines, each a complete sentence or clause.
- Include phase context (SPIN or VALIDATE), service or component names, exit codes, and the key error message.
- Preserve enough detail that a similar future failure could match this text.
- Do NOT suggest fixes or file changes.`;

const SUMMARIZE_DIFF_SYSTEM = `You summarize workspace file changes from a build repair diff.

Rules:
- Output plain text only (no markdown).
- 2-6 short lines maximum.
- Only describe changes explicitly present in the diff — cite file paths.
- Do NOT invent edits, paths, or root causes not shown in the diff.`;

function buildAnchorFailureInput(anchor: LessonAnchorFailure, phase: LessonPhase): string {
  const phaseLabel = phase === 'spin' ? 'SPIN' : 'VALIDATE';
  const lines: string[] = [
    `Phase: ${phaseLabel}`,
    `Attempt: ${anchor.attempt}`,
    `Message: ${anchor.message || '(none)'}`,
  ];
  if (anchor.composeStderr) lines.push(`Stderr: ${cap(anchor.composeStderr, 1500)}`);
  if (anchor.extractedErrors?.length) {
    lines.push(`Extracted errors:\n${anchor.extractedErrors.slice(0, 12).join('\n')}`);
  } else if (anchor.logs) {
    lines.push(`Logs: ${cap(anchor.logs, 1500)}`);
  }
  if (anchor.feedback) lines.push(`Validation feedback: ${cap(anchor.feedback, 800)}`);
  if (anchor.suggestions?.length) {
    lines.push(`Suggestions: ${anchor.suggestions.slice(0, 6).join('; ')}`);
  }
  return cap(lines.join('\n'), ANCHOR_INPUT_MAX) as string;
}

function fallbackFailureSummary(anchor: LessonAnchorFailure, phase: LessonPhase): string {
  const parts: string[] = [
    `${phase.toUpperCase()} failure (attempt ${anchor.attempt}): ${anchor.message || 'unknown error'}`,
  ];
  const extra = anchor.extractedErrors?.[0]
    || (anchor.composeStderr ? String(anchor.composeStderr).split('\n').find((l) => l.trim()) : null)
    || anchor.suggestions?.[0]
    || null;
  if (extra) parts.push(String(extra).trim());
  return cap(parts.join('\n'), FAILURE_SUMMARY_MAX) as string;
}

async function llmDistillFailure(
  anchor: LessonAnchorFailure,
  phase: LessonPhase,
): Promise<string> {
  const input = buildAnchorFailureInput(anchor, phase);
  if (!llm.isConfigured()) return fallbackFailureSummary(anchor, phase);
  try {
    const { text } = await llm.completeMessage({
      system: DISTILL_FAILURE_SYSTEM,
      messages: [{ role: 'user', content: input }],
      maxTokens: 180,
      agent: 'validation',
    });
    const trimmed = (text || '').trim();
    if (trimmed.length >= 20) return cap(trimmed, FAILURE_SUMMARY_MAX) as string;
  } catch (e) {
    console.warn(`[lessons] llmDistillFailure failed: ${(e as Error).message}`);
  }
  return fallbackFailureSummary(anchor, phase);
}

function fallbackFixSummary(phase: LessonPhase): string {
  return phase === 'spin'
    ? 'Stack reached healthy running state after compose/runtime file changes.'
    : 'Validation confirmed the broken state is observable after spec/check file changes.';
}

async function llmSummarizeDiff(
  cumulativeDiff: string | null | undefined,
  phase: LessonPhase,
): Promise<string> {
  const diff = (cumulativeDiff || '').trim();
  if (!diff) return fallbackFixSummary(phase);
  if (!llm.isConfigured()) return cap(diff, FIX_SUMMARY_MAX) as string;
  try {
    const { text } = await llm.completeMessage({
      system: SUMMARIZE_DIFF_SYSTEM,
      messages: [{
        role: 'user',
        content: `Phase: ${phase.toUpperCase()}\n\nFile diff (baseline → success):\n${cap(diff, DIFF_INPUT_MAX)}`,
      }],
      maxTokens: 280,
      agent: 'validation',
    });
    const trimmed = (text || '').trim();
    if (trimmed.length >= 10) return cap(trimmed, FIX_SUMMARY_MAX) as string;
  } catch (e) {
    console.warn(`[lessons] llmSummarizeDiff failed: ${(e as Error).message}`);
  }
  return cap(diff, FIX_SUMMARY_MAX) as string;
}

/**
 * Persist a lesson after a phase succeeds following an earlier failure in the same window.
 * failure_summary ← LLM distill of anchor (e1); fix_summary ← LLM compress of asset diff.
 */
async function record({
  phase,
  draftSessionId,
  buildSessionId,
  category,
  title,
  anchorFailure,
  cumulativeDiff,
}: {
  phase: LessonPhase;
  draftSessionId?: string | null;
  buildSessionId: string;
  category?: string | null;
  title?: string | null;
  anchorFailure: LessonAnchorFailure | null | undefined;
  cumulativeDiff?: string | null;
}): Promise<number | null> {
  if (!anchorFailure) return null;
  if (phase !== 'spin' && phase !== 'validate') return null;

  const failure_summary = await llmDistillFailure(anchorFailure, phase);
  const fix_summary = await llmSummarizeDiff(cumulativeDiff, phase);

  let embedding: number[] | null = null;
  try {
    embedding = await llm.embed(failure_summary);
  } catch (e) {
    console.warn(`[lessons] embed failed: ${(e as Error).message}`);
  }

  const now = Date.now();
  try {
    const { rows } = await pool.query(
      `INSERT INTO lessons
         (phase, draft_session_id, build_session_id, category, title,
          failure_summary, fix_summary, embedding, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9)
       RETURNING id`,
      [
        phase,
        draftSessionId || null,
        buildSessionId,
        category,
        title,
        failure_summary,
        fix_summary,
        embedding ? toPgVector(embedding) : null,
        now,
      ],
    );
    return rows[0]?.id || null;
  } catch (e) {
    console.warn(`[lessons] record failed: ${(e as Error).message}`);
    return null;
  }
}

async function findSimilar({
  text,
  k = LESSONS_K,
  maxDistance = LESSONS_MAX_DISTANCE,
  phase = null,
  category = null,
}: {
  text: string;
  k?: number;
  maxDistance?: number;
  phase?: string | null;
  category?: string | null;
}): Promise<LessonRecord[]> {
  if (!text) return [];
  const vec: number[] | null = await llm.embed(text);
  if (!vec) return [];
  const pgVec = toPgVector(vec);
  try {
    const params: unknown[] = [pgVec, maxDistance, k];
    let sql = `SELECT id, phase, failure_summary, fix_summary, category, title,
                      (embedding <=> $1::vector) AS distance
                 FROM lessons
                WHERE embedding IS NOT NULL
                  AND (embedding <=> $1::vector) <= $2`;
    let n = 4;
    if (phase) { sql += ` AND phase = $${n}`; params.push(phase); n += 1; }
    if (category) { sql += ` AND (category = $${n} OR category IS NULL)`; params.push(category); n += 1; }
    sql += ` ORDER BY embedding <=> $1::vector LIMIT $3`;
    const { rows } = await pool.query(sql, params);
    return rows.map(rowToLesson);
  } catch (e) {
    console.warn(`[lessons] findSimilar failed: ${(e as Error).message}`);
    return [];
  }
}

function shapeLessonForPrompt(lesson: LessonRecord): RelatedLesson {
  return {
    phase: lesson.phase,
    failureSummary: cap(lesson.failureSummary, 2000),
    fixSummary: cap(lesson.fixSummary, 800),
    category: lesson.category,
    similarity: lesson.distance != null
      ? Math.max(0, Math.min(1, 1 - lesson.distance))
      : null,
  };
}

interface SpinFailure {
  message?: string;
  composeStderr?: string | null;
  logs?: string | null;
  extractedErrors?: string[];
}

interface ValidateFailure {
  message?: string;
  suggestions?: string[];
}

async function findForRetry({
  draft,
  spinFailureMsg,
  validateFailureMsg,
  k = LESSONS_K,
}: {
  draft?: { meta?: { category?: string }; category?: string } | null;
  spinFailureMsg?: SpinFailure | null;
  validateFailureMsg?: ValidateFailure | null;
  k?: number;
}): Promise<LessonsBlock> {
  const parts: string[] = [];
  if (spinFailureMsg) {
    parts.push(spinFailureMsg.message || '');
    parts.push(spinFailureMsg.composeStderr || '');
    if (Array.isArray(spinFailureMsg.extractedErrors) && spinFailureMsg.extractedErrors.length) {
      parts.push(spinFailureMsg.extractedErrors.join('\n'));
    } else {
      parts.push(spinFailureMsg.logs || '');
    }
  }
  if (validateFailureMsg) {
    parts.push(validateFailureMsg.message || '');
    if (Array.isArray(validateFailureMsg.suggestions)) {
      parts.push(validateFailureMsg.suggestions.join(' '));
    }
  }
  const text = parts.filter(Boolean).join('\n').trim();
  if (!text) return { relatedLessons: [] };

  const category = draft?.meta?.category || draft?.category || null;
  const hits = await findSimilar({ text, k, category: category as string | null });
  const byId = new Map<number, LessonRecord>();
  for (const h of hits) byId.set(h.id, h);

  if (spinFailureMsg && validateFailureMsg) {
    const spinHits = await findSimilar({
      text: [
        spinFailureMsg.message,
        (spinFailureMsg.extractedErrors || []).join('\n') || spinFailureMsg.logs,
      ].filter(Boolean).join('\n'),
      k: Math.ceil(k / 2),
      phase: 'spin',
      category: category as string | null,
    });
    const valHits = await findSimilar({
      text: [validateFailureMsg.message, (validateFailureMsg.suggestions || []).join(' ')].join('\n'),
      k: Math.ceil(k / 2),
      phase: 'validate',
      category: category as string | null,
    });
    for (const h of [...spinHits, ...valHits]) byId.set(h.id, h);
  }

  const merged = [...byId.values()]
    .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
    .slice(0, k);

  return { relatedLessons: merged.map(shapeLessonForPrompt) };
}

function rowToLesson(r: Record<string, unknown>): LessonRecord {
  return {
    id: r.id as number,
    phase: r.phase as LessonPhase,
    failureSummary: r.failure_summary as string,
    fixSummary: r.fix_summary as string,
    category: r.category as string | null,
    title: r.title as string | null,
    distance: r.distance != null ? Number(r.distance) : null,
  };
}

async function count(): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM lessons`);
  return rows[0]?.n || 0;
}

async function listPaginated({
  page = 1,
  limit = 20,
  phase = null,
  category = null,
}: {
  page?: number;
  limit?: number;
  phase?: string | null;
  category?: string | null;
} = {}): Promise<{
  items: unknown[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const safeLimit = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 50);
  const safePage = Math.max(parseInt(String(page), 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const where: string[] = [];
  const params: unknown[] = [];
  let n = 1;

  if (phase === 'spin' || phase === 'validate') {
    where.push(`phase = $${n}`); params.push(phase); n += 1;
  }
  if (category) {
    where.push(`category = $${n}`); params.push(category); n += 1;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await pool.query(`SELECT COUNT(*)::int AS n FROM lessons ${whereSql}`, params);
  const total = countRes.rows[0]?.n || 0;

  const { rows } = await pool.query(
    `SELECT id, phase, draft_session_id, build_session_id, category, title,
            failure_summary, fix_summary, created_at
       FROM lessons
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${n} OFFSET $${n + 1}`,
    [...params, safeLimit, offset],
  );

  return {
    items: rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      phase: r.phase,
      draftSessionId: r.draft_session_id,
      buildSessionId: r.build_session_id,
      category: r.category,
      title: r.title,
      failureSummary: r.failure_summary,
      fixSummary: r.fix_summary,
      createdAt: Number(r.created_at),
    })),
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

async function backfillEmbeddings({ limit = 50 }: { limit?: number } = {}): Promise<number> {
  if (!llm.isEmbeddingConfigured()) return 0;
  let done = 0;
  try {
    const { rows } = await pool.query(
      `SELECT id, failure_summary FROM lessons WHERE embedding IS NULL ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    for (const r of rows as Array<{ id: number; failure_summary: string }>) {
      const vec: number[] | null = await llm.embed(r.failure_summary);
      if (!vec) continue;
      await pool.query(`UPDATE lessons SET embedding = $1::vector WHERE id = $2`, [toPgVector(vec), r.id]);
      done += 1;
    }
  } catch (e) {
    console.warn(`[lessons] backfill failed: ${(e as Error).message}`);
  }
  return done;
}

module.exports = {
  record,
  findForRetry,
  findSimilar,
  count,
  listPaginated,
  backfillEmbeddings,
};
