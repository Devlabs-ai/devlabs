'use strict';

/**
 * Persistent store for build-pipeline lessons — structured memories of SPIN/VALIDATE
 * failures and fixes. `failure_summary` is embedded (pgvector) at write time and matched
 * via cosine similarity when repairing after a phase failure.
 */

import type { ChallengeDraft, LessonRecord, LessonPhase, LessonsBlock, RelatedLesson } from '../../types/domain';

const pool = require('../../db/pool');
const llm = require('../../llm/client');

const LESSONS_K = 8;
const LESSONS_MAX_DISTANCE = 0.45;
const FAILURE_SUMMARY_MAX = 6000;

/**
 * Serialize a float embedding array into the literal string format expected by
 * pgvector query parameters (e.g. `[0.1,0.2,...]`).
 */
function toPgVector(arr: number[]): string {
  return `[${arr.join(',')}]`;
}

/**
 * Truncate a string (or stringifiable value) to `max` characters for prompt/DB safety.
 */
function cap(s: unknown, max: number): string | null | undefined {
  if (!s) return s as string | null | undefined;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated]`;
}

interface FailureSnapshot {
  attempt: number;
  phase: string;
  message: string | null;
  composeStderr?: string | null;
  logs?: string | null;
  feedback?: string | null;
  [key: string]: unknown;
}

interface LessonAssets {
  dockerCompose?: string;
  [key: string]: unknown;
}

const SYNTHESIS_SYSTEM = `You are a build-pipeline analyst. Given information about a failed (and possibly later fixed) Docker compose build, produce a concise structured lesson for future LLM build agents.

Output ONLY the following four lines, each prefixed exactly as shown (no extra lines, no markdown):
Error pattern: <one line — service name, exit code, and the key error message>
Root cause: <one line — the technical root cause>
Fix applied: <one line — the specific change that resolved it>
Avoid: <one line — what future builds should not do>

Be specific and concrete. Do not repeat the same information across fields.`;

function extractPrefixedLine(text: string, prefix: string): string | null {
  const line = text.split('\n').find((l) => l.trimStart().startsWith(prefix));
  if (!line) return null;
  return line.trim();
}

/**
 * Format the user message sent to the LLM when synthesizing fix guidance.
 */
function buildSynthesisUserMessage({
  phase,
  failures,
  assets,
  validationFeedback,
}: {
  phase: LessonPhase;
  failures: FailureSnapshot[];
  assets?: LessonAssets | null;
  validationFeedback?: string | null;
}): string {
  const phaseLabel = phase === 'spin' ? 'SPIN' : 'VALIDATE';
  const lines: string[] = [`Phase: ${phaseLabel}`, 'Outcome: eventually succeeded after prior failures'];

  lines.push('\nFailure history:');
  for (const f of failures) {
    lines.push(`  Attempt ${f.attempt}: ${cap(f.message, 300)}`);
    if (f.composeStderr) lines.push(`  stderr: ${cap(f.composeStderr, 200)}`);
    if (f.logs) lines.push(`  logs: ${cap(f.logs, 200)}`);
    if (f.feedback) lines.push(`  feedback: ${cap(f.feedback, 200)}`);
  }
  if (validationFeedback) {
    lines.push(`\nFinal validation feedback: ${cap(validationFeedback, 400)}`);
  }

  if (assets?.dockerCompose) {
    const envLines = assets.dockerCompose
      .split('\n')
      .filter((l: string) => /image:|environment:|REDIS_|POSTGRES_|HOST|PORT|_HOST|_URL/i.test(l))
      .slice(0, 20)
      .join('\n');
    if (envLines) lines.push(`\nRelevant compose lines:\n${envLines}`);
  }

  return lines.join('\n');
}

/**
 * Ask the LLM to distill failures into Error pattern / Root cause / Fix / Avoid lines.
 */
async function synthesizeLesson({
  phase,
  failures,
  assets,
  validationFeedback,
}: {
  phase: LessonPhase;
  failures: FailureSnapshot[];
  assets?: LessonAssets | null;
  validationFeedback?: string | null;
}): Promise<string | null> {
  if (!llm.isConfigured()) return null;
  try {
    const { text } = await llm.completeMessage({
      system: SYNTHESIS_SYSTEM,
      messages: [{
        role: 'user',
        content: buildSynthesisUserMessage({ phase, failures, assets, validationFeedback }),
      }],
      maxTokens: 200,
      agent: 'validation',
    });
    if (text.includes('Error pattern:') && text.includes('Fix applied:')) {
      return text.trim();
    }
    return null;
  } catch (e) {
    console.warn(`[lessons] synthesizeLesson failed: ${(e as Error).message}`);
    return null;
  }
}

/** Rich failure narrative stored and embedded for similarity search. */
function buildFailureSummary(
  failures: FailureSnapshot[],
  phase: LessonPhase,
  synthesized: string | null,
  validationFeedback: string | null,
): string {
  const lines: string[] = [];

  if (synthesized) {
    const errorPattern = extractPrefixedLine(synthesized, 'Error pattern:');
    const rootCause = extractPrefixedLine(synthesized, 'Root cause:');
    if (errorPattern) lines.push(errorPattern);
    if (rootCause) lines.push(rootCause);
    if (lines.length) lines.push('');
  }

  lines.push('Failure history:');
  for (const f of failures) {
    lines.push(`Attempt ${f.attempt} (${f.phase || phase}): ${f.message || '(no message)'}`);
    if (f.composeStderr) lines.push(`  stderr: ${cap(f.composeStderr, 400)}`);
    if (f.logs) lines.push(`  logs: ${cap(f.logs, 400)}`);
    if (f.feedback) lines.push(`  feedback: ${cap(f.feedback, 400)}`);
  }

  if (validationFeedback) {
    lines.push(`Validation feedback: ${cap(validationFeedback, 500)}`);
  }

  return cap(lines.join('\n').trim(), FAILURE_SUMMARY_MAX) as string;
}

/** Actionable fix guidance passed to the CODE agent (not embedded). */
function buildFixSummary(synthesized: string | null, phase: LessonPhase): string {
  if (synthesized) {
    const fixApplied = extractPrefixedLine(synthesized, 'Fix applied:');
    const avoid = extractPrefixedLine(synthesized, 'Avoid:');
    const parts: string[] = [];
    if (fixApplied) parts.push(fixApplied);
    if (avoid) parts.push(avoid);
    if (parts.length) return parts.join('\n');
  }
  return phase === 'spin'
    ? 'Stack reached healthy running state after compose/runtime fixes.'
    : 'Validation confirmed the broken state is observable after spec/check fixes.';
}

/**
 * Persist a new lesson after a phase succeeds following prior failures in the same build.
 * Embeds `failure_summary` only. Returns the new row id, or null when skipped.
 */
async function record({
  phase,
  draftSessionId,
  buildSessionId,
  category,
  title,
  failures,
  assets,
  validationFeedback = null,
}: {
  phase: LessonPhase;
  draftSessionId?: string | null;
  buildSessionId: string;
  category?: string | null;
  title?: string | null;
  draft?: ChallengeDraft | null;
  failures: FailureSnapshot[];
  assets?: LessonAssets | null;
  validationFeedback?: string | null;
}): Promise<number | null> {
  if (!failures || failures.length === 0) return null;
  if (phase !== 'spin' && phase !== 'validate') return null;

  const synthesized = await synthesizeLesson({
    phase,
    failures,
    assets,
    validationFeedback,
  });
  const failure_summary = buildFailureSummary(
    failures,
    phase,
    synthesized,
    validationFeedback,
  );
  const fix_summary = buildFixSummary(synthesized, phase);

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

/**
 * Core vector search: embed query text, then query `lessons` by cosine distance (`<=>`).
 * Stored embeddings are always `embed(failure_summary)`.
 */
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

/** Compact object injected into the CODE agent's `lessonsBlock.relatedLessons`. */
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

/**
 * Repair-time retrieval after SPIN or VALIDATE failure. Embeds failure signals and
 * matches against stored failure_summary embeddings.
 */
async function findForRetry({
  draft,
  spinFailureMsg,
  validateFailureMsg,
  k = LESSONS_K,
}: {
  draft?: ChallengeDraft | null;
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

/** Return the total number of rows in the `lessons` table. */
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

/** Re-embed rows where embedding IS NULL using failure_summary. */
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
