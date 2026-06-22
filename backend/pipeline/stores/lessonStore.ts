'use strict';

/**
 * Persistent store for build-pipeline lessons — structured memories of SPIN/VALIDATE
 * failures and fixes. Lessons are embedded (pgvector) at write time and retrieved via
 * cosine similarity when warm-starting a build or repairing after a phase failure.
 */

import type { ChallengeDraft, LessonRecord, LessonPhase } from '../../types/domain';

const pool = require('../../db/pool');
const llm = require('../../llm/client');

const LESSONS_K = 8;
const LESSONS_MAX_DISTANCE = 0.45;

/**
 * Serialize a float embedding array into the literal string format expected by
 * pgvector query parameters (e.g. `[0.1,0.2,...]`).
 */
function toPgVector(arr: number[]): string {
  return `[${arr.join(',')}]`;
}

/**
 * Truncate a string (or stringifiable value) to `max` characters for prompt/DB safety.
 * Falsy inputs pass through unchanged; longer strings get a trailing truncation marker.
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
  message: string;
  [key: string]: unknown;
}

interface LessonAssets {
  dockerCompose?: string;
  [key: string]: unknown;
}

/**
 * Build the human-readable `problem_context` field stored on each lesson row.
 * Pulls title, category, root cause, and description from the challenge draft so
 * retrieval results carry enough context even without joining back to drafts.
 */
function buildProblemContext(draft: ChallengeDraft | null | undefined): string {
  const parts: string[] = [];
  const title = draft?.meta?.name || draft?.title;
  if (title) parts.push(`Title: ${title}`);
  const category = draft?.meta?.category || draft?.category;
  if (category) parts.push(`Category: ${category}`);
  const rootCause = draft?.brokenState?.rootCause;
  if (rootCause) parts.push(`Root cause: ${cap(rootCause, 400)}`);
  const desc = draft?.description;
  if (desc) parts.push(`Description: ${cap(desc, 400)}`);
  return parts.join('\n') || 'Interview sandbox challenge';
}

const SYNTHESIS_SYSTEM = `You are a build-pipeline analyst. Given information about a failed (and possibly later fixed) Docker compose build, produce a concise structured lesson for future LLM build agents.

Output ONLY the following four lines, each prefixed exactly as shown (no extra lines, no markdown):
Error pattern: <one line — service name, exit code, and the key error message>
Root cause: <one line — the technical root cause>
Fix applied: <one line — the specific change that resolved it, or "unresolved" if it never passed>
Avoid: <one line — what future builds should not do>

Be specific and concrete. Do not repeat the same information across fields.`;

/**
 * Format the user message sent to the LLM when synthesizing a structured lesson.
 * Includes phase, per-attempt failure messages, stderr snippets, and a filtered
 * excerpt of docker-compose lines relevant to infra wiring.
 */
function buildSynthesisUserMessage({
  phase,
  failures,
  assets,
}: {
  phase: LessonPhase;
  failures: FailureSnapshot[];
  assets?: LessonAssets | null;
}): string {
  const phaseLabel = phase === 'spin' ? 'SPIN' : 'VALIDATE';
  const lines: string[] = [`Phase: ${phaseLabel}`, 'Outcome: eventually succeeded after prior failures'];

  lines.push('\nFailure history:');
  for (const f of failures) {
    lines.push(`  Attempt ${f.attempt}: ${cap(f.message, 300)}`);
    const d = f.details as Record<string, unknown> | null | undefined;
    if (d?.composeStderr) lines.push(`  stderr: ${cap(d.composeStderr, 200)}`);
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
 * Ask the LLM to distill a failure history into a four-line structured lesson
 * (Error pattern / Root cause / Fix applied / Avoid). Returns null when the LLM
 * is unavailable, the response is malformed, or the call fails.
 */
async function synthesizeLesson({
  phase,
  failures,
  assets,
}: {
  phase: LessonPhase;
  failures: FailureSnapshot[];
  assets?: LessonAssets | null;
}): Promise<string | null> {
  if (!llm.isConfigured()) return null;
  try {
    const { text } = await llm.completeMessage({
      system: SYNTHESIS_SYSTEM,
      messages: [{ role: 'user', content: buildSynthesisUserMessage({ phase, failures, assets }) }],
      maxTokens: 200,
      agent: 'validation',
    });
    if (text.includes('Error pattern:') && text.includes('Root cause:')) {
      return text.trim();
    }
    return null;
  } catch (e) {
    console.warn(`[lessons] synthesizeLesson failed: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Fallback lesson body when LLM synthesis fails. Lists each failed attempt and
 * appends a truncated working docker-compose excerpt to aid future similarity search.
 */
function buildRawLessonText({
  phase,
  category,
  failures,
  assets,
}: {
  phase: LessonPhase;
  category?: string | null;
  failures: FailureSnapshot[];
  assets?: LessonAssets | null;
}): string {
  const phaseLabel = phase === 'spin' ? 'SPIN' : 'VALIDATE';
  const lines: string[] = [
    `${phaseLabel} phase succeeded after failures${category ? ` for category ${category}` : ''}.`,
    `Failures (${failures.length}):`,
    ...failures.map((f) => `- Attempt ${f.attempt}: ${cap(f.message, 300)}`),
  ];
  if (assets?.dockerCompose) {
    lines.push('Working compose (excerpt):');
    lines.push(cap(assets.dockerCompose, 800) as string);
  }
  return lines.join('\n');
}

/**
 * Persist a new lesson after a phase succeeds following prior failures in the same
 * build. Builds summaries, synthesizes lesson text, embeds it, and INSERTs into
 * `lessons`. Returns the new row id, or null when validation fails, embedding/insert
 * errors occur, or the failures array is empty.
 */
async function record({
  phase,
  draftSessionId,
  buildSessionId,
  category,
  title,
  draft,
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

  const problem_context = buildProblemContext(draft);

  const failure_summary = failures
    .map((f) => `Attempt ${f.attempt} (${f.phase || phase}): ${f.message || '(no message)'}`)
    .join('\n');

  const fix_summary = phase === 'spin'
    ? 'Docker compose stack reached a healthy running state.'
    : 'Validation confirmed the broken state is observable in the sandbox.';

  const synthesized = await synthesizeLesson({ phase, failures, assets });
  const lesson_text = synthesized || buildRawLessonText({ phase, category, failures, assets });

  let embedding: number[] | null = null;
  try {
    embedding = await llm.embed(lesson_text);
  } catch (e) {
    console.warn(`[lessons] embed failed: ${(e as Error).message}`);
  }

  const now = Date.now();
  try {
    const { rows } = await pool.query(
      `INSERT INTO lessons
         (phase, draft_session_id, build_session_id, category, title,
          problem_context, failure_summary, fix_summary, lesson_text, details,
          embedding, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::vector,$12)
       RETURNING id`,
      [
        phase,
        draftSessionId || null,
        buildSessionId,
        category,
        title,
        problem_context,
        failure_summary,
        fix_summary,
        lesson_text,
        JSON.stringify({
          failureHistory: failures,
          workingCompose: cap(assets?.dockerCompose, 3500) || null,
          validationFeedback,
          synthesized: !!synthesized,
        }),
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
 * Core vector search: embed `text`, then query `lessons` by cosine distance (`<=>`).
 * Only rows with a non-null embedding participate. Optional filters narrow by phase
 * and category (also matches NULL category rows). Results are ordered nearest-first
 * and capped at `k`.
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
    let sql = `SELECT id, phase, lesson_text, failure_summary, fix_summary, details, category,
                      title, problem_context,
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

/**
 * Convert a DB lesson row into the compact object injected into the code agent's
 * `lessonsBlock.relatedLessons` payload. Caps long text fields and converts cosine
 * distance to a 0–1 similarity score for logging and agent consumption.
 */
function shapeLessonForPrompt(lesson: LessonRecord): Record<string, unknown> {
  return {
    phase: lesson.phase,
    text: cap(lesson.text, 2000),
    failureSummary: cap(lesson.failureSummary, 800),
    fixSummary: cap(lesson.fixSummary, 400),
    category: lesson.category,
    similarity: lesson.distance != null
      ? Math.max(0, Math.min(1, 1 - lesson.distance))
      : null,
    details: lesson.details || null,
  };
}

/**
 * Warm-start retrieval before iteration 1: embed draft description, root cause,
 * title, and category, then find the closest past lessons (optionally scoped to the
 * same category). Called once at pipeline start; results may be reused on the first
 * CODE iteration when no SPIN/VALIDATE failure is active yet.
 */
async function findByDraftContext(
  draft: ChallengeDraft | null | undefined,
  { k = 4 }: { k?: number } = {},
): Promise<{ relatedLessons: ReturnType<typeof shapeLessonForPrompt>[] }> {
  const category = draft?.meta?.category || draft?.category || null;
  const parts: string[] = [];
  const desc = draft?.description;
  if (desc) parts.push(cap(desc, 400) as string);
  const rootCause = draft?.brokenState?.rootCause;
  if (rootCause) parts.push(rootCause);
  const title = draft?.meta?.name || draft?.title;
  if (title) parts.push(title as string);
  if (category) parts.push(category as string);

  const text = parts.filter(Boolean).join('\n').trim();
  if (!text) return { relatedLessons: [] };

  const hits = await findSimilar({ text, k, category: category as string | null });
  const sorted = hits
    .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
    .slice(0, k);

  return { relatedLessons: sorted.map(shapeLessonForPrompt) };
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
 * Repair-time retrieval after a SPIN or VALIDATE failure. Embeds failure messages,
 * stderr/logs/extracted errors, and validation suggestions, then searches for similar
 * past lessons. When both SPIN and VALIDATE signals are present, runs separate
 * phase-scoped searches and merges/deduplicates by lesson id before ranking.
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
}): Promise<{ relatedLessons: ReturnType<typeof shapeLessonForPrompt>[] }> {
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

/**
 * Map a raw Postgres result row (snake_case columns) to the application
 * `LessonRecord` shape, including numeric distance from similarity search.
 */
function rowToLesson(r: Record<string, unknown>): LessonRecord {
  return {
    id: r.id as number,
    phase: r.phase as LessonPhase,
    text: r.lesson_text as string,
    failureSummary: r.failure_summary as string,
    fixSummary: r.fix_summary as string,
    category: r.category as string | null,
    title: r.title as string | null,
    problemContext: r.problem_context as string | null,
    details: r.details as Record<string, unknown> | null,
    distance: r.distance != null ? Number(r.distance) : null,
  };
}

/** Return the total number of rows in the `lessons` table. */
async function count(): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM lessons`);
  return rows[0]?.n || 0;
}

/**
 * Admin/API listing of lessons with optional phase and category filters.
 * Returns a page of rows (newest first), total count, and pagination metadata.
 * Limit is clamped to 1–50 per page.
 */
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
            problem_context, failure_summary, fix_summary, lesson_text, details, created_at
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
      problemContext: r.problem_context,
      failureSummary: r.failure_summary,
      fixSummary: r.fix_summary,
      lessonText: r.lesson_text,
      details: r.details,
      createdAt: Number(r.created_at),
    })),
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

/**
 * One-off maintenance: embed `lesson_text` for rows that were inserted with
 * `embedding IS NULL` (e.g. after a transient embed failure). Processes up to
 * `limit` rows, newest first. Returns how many rows were successfully updated.
 * Not invoked automatically on server startup.
 */
async function backfillEmbeddings({ limit = 50 }: { limit?: number } = {}): Promise<number> {
  if (!llm.isEmbeddingConfigured()) return 0;
  let done = 0;
  try {
    const { rows } = await pool.query(
      `SELECT id, lesson_text FROM lessons WHERE embedding IS NULL ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    for (const r of rows as Array<{ id: number; lesson_text: string }>) {
      const vec: number[] | null = await llm.embed(r.lesson_text);
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
  findByDraftContext,
  findSimilar,
  count,
  listPaginated,
  backfillEmbeddings,
  buildProblemContext,
};
