'use strict';

import type { ChallengeDraft, LessonRecord, LessonType, LessonPhase } from '../../types/domain';

const pool = require('../../db/pool');
const llm = require('../../llm/client');

const LESSONS_K = 8;
const LESSONS_MAX_DISTANCE = 0.45;

/** DB stores SPIN phase as `start`; app code uses `spin`. */
function phaseToDb(phase: LessonPhase | string | null | undefined): string | null {
  if (!phase) return null;
  if (phase === 'spin' || phase === 'start') return 'start';
  return 'validate';
}

function phaseFromDb(phase: string | null | undefined): LessonPhase {
  if (phase === 'start') return 'spin';
  return 'validate';
}

function toPgVector(arr: number[]): string {
  return `[${arr.join(',')}]`;
}

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

function buildSynthesisUserMessage({
  type,
  phase,
  failures,
  assets,
}: {
  type: LessonType;
  phase: LessonPhase;
  failures: FailureSnapshot[];
  assets?: LessonAssets | null;
}): string {
  const phaseLabel = phase === 'spin' ? 'START/SPIN' : 'VALIDATE';
  const lines: string[] = [`Phase: ${phaseLabel}`, `Outcome: ${type === 'fix' ? 'eventually succeeded' : 'exhausted all retries — never passed'}`];

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

async function synthesizeLesson({
  type,
  phase,
  failures,
  assets,
}: {
  type: LessonType;
  phase: LessonPhase;
  failures: FailureSnapshot[];
  assets?: LessonAssets | null;
}): Promise<string | null> {
  if (!llm.isConfigured()) return null;
  try {
    const { text } = await llm.completeMessage({
      system: SYNTHESIS_SYSTEM,
      messages: [{ role: 'user', content: buildSynthesisUserMessage({ type, phase, failures, assets }) }],
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

function buildRawLessonText({
  type,
  phase,
  category,
  failures,
  assets,
}: {
  type: LessonType;
  phase: LessonPhase;
  category?: string | null;
  failures: FailureSnapshot[];
  assets?: LessonAssets | null;
}): string {
  const phaseLabel = phase === 'spin' ? 'SPIN' : 'VALIDATE';
  const outcome = type === 'anti-pattern' ? 'never passed (anti-pattern)' : 'succeeded after failures';
  const lines: string[] = [
    `${phaseLabel} phase ${outcome}${category ? ` for category ${category}` : ''}.`,
    `Failures (${failures.length}):`,
    ...failures.map((f) => `- Attempt ${f.attempt}: ${cap(f.message, 300)}`),
  ];
  if (type === 'fix' && assets?.dockerCompose) {
    lines.push('Working compose (excerpt):');
    lines.push(cap(assets.dockerCompose, 800) as string);
  }
  return lines.join('\n');
}

async function record({
  type = 'fix',
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
  type?: LessonType;
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
  if (type !== 'fix' && type !== 'anti-pattern') return null;

  const problem_context = buildProblemContext(draft);

  const failure_summary = failures
    .map((f) => `Attempt ${f.attempt} (${f.phase || phase}): ${f.message || '(no message)'}`)
    .join('\n');

  const fix_summary = type === 'anti-pattern'
    ? `${phase === 'spin' ? 'START' : 'VALIDATE'} phase never passed — anti-pattern recorded.`
    : phase === 'spin'
      ? 'Docker compose stack reached a healthy running state.'
      : 'Validation confirmed the broken state is observable in the sandbox.';

  const synthesized = type === 'anti-pattern'
    ? null
    : await synthesizeLesson({ type, phase, failures, assets });
  const lesson_text = synthesized || buildRawLessonText({ type, phase, category, failures, assets });

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
         (type, phase, draft_session_id, build_session_id, category, title,
          problem_context, failure_summary, fix_summary, lesson_text, details,
          embedding, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::vector,$13)
       RETURNING id`,
      [
        type,
        phaseToDb(phase),
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
          workingCompose: type === 'fix' ? cap(assets?.dockerCompose, 3500) : null,
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

async function findSimilar({
  text,
  k = LESSONS_K,
  maxDistance = LESSONS_MAX_DISTANCE,
  phase = null,
  category = null,
  type = null,
}: {
  text: string;
  k?: number;
  maxDistance?: number;
  phase?: string | null;
  category?: string | null;
  type?: string | null;
}): Promise<LessonRecord[]> {
  if (!text) return [];
  const vec: number[] | null = await llm.embed(text);
  if (!vec) return [];
  const pgVec = toPgVector(vec);
  try {
    const params: unknown[] = [pgVec, maxDistance, k];
    let sql = `SELECT id, type, phase, lesson_text, failure_summary, fix_summary, details, category,
                      title, problem_context,
                      (embedding <=> $1::vector) AS distance
                 FROM lessons
                WHERE embedding IS NOT NULL
                  AND (embedding <=> $1::vector) <= $2`;
    let n = 4;
    if (phase) { sql += ` AND phase = $${n}`; params.push(phaseToDb(phase)); n += 1; }
    if (category) { sql += ` AND (category = $${n} OR category IS NULL)`; params.push(category); n += 1; }
    if (type) { sql += ` AND type = $${n}`; params.push(type); n += 1; }
    sql += ` ORDER BY embedding <=> $1::vector LIMIT $3`;
    const { rows } = await pool.query(sql, params);
    return rows.map(rowToLesson);
  } catch (e) {
    console.warn(`[lessons] findSimilar failed: ${(e as Error).message}`);
    return [];
  }
}

function shapeLessonForPrompt(lesson: LessonRecord): Record<string, unknown> {
  return {
    type: lesson.type || 'fix',
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
  draft?: ChallengeDraft | null;
  spinFailureMsg?: SpinFailure | null;
  validateFailureMsg?: ValidateFailure | null;
  k?: number;
}): Promise<{ relatedLessons: ReturnType<typeof shapeLessonForPrompt>[] }> {
  const parts: string[] = [];
  if (spinFailureMsg) {
    parts.push(spinFailureMsg.message || '');
    parts.push(spinFailureMsg.composeStderr || '');
    parts.push(spinFailureMsg.logs || '');
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
    const startHits = await findSimilar({
      text: [spinFailureMsg.message, spinFailureMsg.logs].filter(Boolean).join('\n'),
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
    for (const h of [...startHits, ...valHits]) byId.set(h.id, h);
  }

  const merged = [...byId.values()]
    .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
    .slice(0, k);

  return { relatedLessons: merged.map(shapeLessonForPrompt) };
}

function rowToLesson(r: Record<string, unknown>): LessonRecord {
  return {
    id: r.id as number,
    type: (r.type as LessonType) || 'fix',
    phase: phaseFromDb(r.phase as string),
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
    where.push(`phase = $${n}`); params.push(phaseToDb(phase)); n += 1;
  }
  if (category) {
    where.push(`category = $${n}`); params.push(category); n += 1;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await pool.query(`SELECT COUNT(*)::int AS n FROM lessons ${whereSql}`, params);
  const total = countRes.rows[0]?.n || 0;

  const { rows } = await pool.query(
    `SELECT id, type, phase, draft_session_id, build_session_id, category, title,
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
      type: r.type || 'fix',
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
