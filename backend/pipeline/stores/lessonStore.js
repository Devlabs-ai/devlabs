'use strict';

// Learned lessons from builds.
//
// Two lesson types:
//   'fix'          — phase failed ≥1 time then succeeded within the same run.
//                    Answers: "this error appeared, here is what fixed it."
//   'anti-pattern' — build exhausted all iterations without ever passing.
//                    Answers: "these approaches were tried and failed — avoid them."
//
// lesson_text (and therefore the embedding) is a short LLM-synthesized
// summary (4 fields, ~40 words). Raw logs / full compose YAML are stored
// only in details JSONB — never embedded.
//
// Retrieval happens at two points in buildPipeline:
//   1. Before iteration 1 — findByDraftContext() using draft description +
//      rootCause + category for a warm start.
//   2. From iteration 2 onwards — findForRetry() using the current failure
//      message (existing behaviour, unchanged).

const pool = require('../../db/pool');
const llm = require('../../llm/client');

const LESSONS_K = 8;
const LESSONS_MAX_DISTANCE = 0.45;

function toPgVector(arr) {
  return `[${arr.join(',')}]`;
}

function cap(s, max) {
  if (!s) return s;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated]`;
}

// ---------------------------------------------------------------------------
// Draft context builder — reads current schema fields
// ---------------------------------------------------------------------------

function buildProblemContext(draft) {
  const parts = [];
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

// ---------------------------------------------------------------------------
// LLM synthesis — produce a clean 4-field lesson text
// ---------------------------------------------------------------------------

const SYNTHESIS_SYSTEM = `You are a build-pipeline analyst. Given information about a failed (and possibly later fixed) Docker compose build, produce a concise structured lesson for future LLM build agents.

Output ONLY the following four lines, each prefixed exactly as shown (no extra lines, no markdown):
Error pattern: <one line — service name, exit code, and the key error message>
Root cause: <one line — the technical root cause>
Fix applied: <one line — the specific change that resolved it, or "unresolved" if it never passed>
Avoid: <one line — what future builds should not do>

Be specific and concrete. Do not repeat the same information across fields.`;

function buildSynthesisUserMessage({ type, phase, failures, assets }) {
  const phaseLabel = phase === 'spin' ? 'START/SPIN' : 'VALIDATE';
  const lines = [`Phase: ${phaseLabel}`, `Outcome: ${type === 'fix' ? 'eventually succeeded' : 'exhausted all retries — never passed'}`];

  lines.push('\nFailure history:');
  for (const f of failures) {
    lines.push(`  Attempt ${f.attempt}: ${cap(f.message, 300)}`);
    if (f.details?.composeStderr) lines.push(`  stderr: ${cap(f.details.composeStderr, 200)}`);
  }

  if (assets?.dockerCompose) {
    // Include only env sections and image lines — not the full YAML
    const envLines = assets.dockerCompose
      .split('\n')
      .filter((l) => /image:|environment:|REDIS_|POSTGRES_|HOST|PORT|_HOST|_URL/i.test(l))
      .slice(0, 20)
      .join('\n');
    if (envLines) lines.push(`\nRelevant compose lines:\n${envLines}`);
  }

  return lines.join('\n');
}

async function synthesizeLesson({ type, phase, failures, assets }) {
  if (!llm.isConfigured()) return null;
  try {
    const text = await llm.completeMessage({
      system: SYNTHESIS_SYSTEM,
      messages: [{ role: 'user', content: buildSynthesisUserMessage({ type, phase, failures, assets }) }],
      maxTokens: 200,
      agent: 'validation', // cheap model (gpt-4o-mini)
    });
    // Validate it has the expected structure
    if (text.includes('Error pattern:') && text.includes('Root cause:')) {
      return text.trim();
    }
    return null;
  } catch (e) {
    console.warn(`[lessons] synthesizeLesson failed: ${e.message}`);
    return null;
  }
}

// Fallback when LLM synthesis is unavailable
function buildRawLessonText({ type, phase, category, failures, assets }) {
  const phaseLabel = phase === 'spin' ? 'SPIN' : 'VALIDATE';
  const outcome = type === 'anti-pattern' ? 'never passed (anti-pattern)' : 'succeeded after failures';
  const lines = [
    `${phaseLabel} phase ${outcome}${category ? ` for category ${category}` : ''}.`,
    `Failures (${failures.length}):`,
    ...failures.map((f) => `- Attempt ${f.attempt}: ${cap(f.message, 300)}`),
  ];
  if (type === 'fix' && assets?.dockerCompose) {
    lines.push('Working compose (excerpt):');
    lines.push(cap(assets.dockerCompose, 800));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// record() — write a lesson to DB
// ---------------------------------------------------------------------------

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
}) {
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

  // Attempt LLM synthesis; fall back to raw text so a lesson is always stored
  const synthesized = await synthesizeLesson({ type, phase, failures, assets });
  const lesson_text = synthesized || buildRawLessonText({ type, phase, category, failures, assets });

  let embedding = null;
  try {
    embedding = await llm.embed(lesson_text);
  } catch (e) {
    console.warn(`[lessons] embed failed: ${e.message}`);
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
    console.warn(`[lessons] record failed: ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// findSimilar() — cosine search
// ---------------------------------------------------------------------------

async function findSimilar({ text, k = LESSONS_K, maxDistance = LESSONS_MAX_DISTANCE, phase = null, category = null, type = null }) {
  if (!text) return [];
  const vec = await llm.embed(text);
  if (!vec) return [];
  const pgVec = toPgVector(vec);
  try {
    const params = [pgVec, maxDistance, k];
    let sql = `SELECT id, type, phase, lesson_text, failure_summary, fix_summary, details, category,
                      title, problem_context,
                      (embedding <=> $1::vector) AS distance
                 FROM lessons
                WHERE embedding IS NOT NULL
                  AND (embedding <=> $1::vector) <= $2`;
    let n = 4;
    if (phase) { sql += ` AND phase = $${n}`; params.push(phase); n += 1; }
    if (category) { sql += ` AND (category = $${n} OR category IS NULL)`; params.push(category); n += 1; }
    if (type) { sql += ` AND type = $${n}`; params.push(type); n += 1; }
    sql += ` ORDER BY embedding <=> $1::vector LIMIT $3`;
    const { rows } = await pool.query(sql, params);
    return rows.map(rowToLesson);
  } catch (e) {
    console.warn(`[lessons] findSimilar failed: ${e.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// shapeLessonForPrompt() — what the code agent sees
// ---------------------------------------------------------------------------

function shapeLessonForPrompt(lesson) {
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

// ---------------------------------------------------------------------------
// findByDraftContext() — warm-start retrieval BEFORE iteration 1
// Uses draft description + rootCause + category — no failure msg needed.
// ---------------------------------------------------------------------------

async function findByDraftContext(draft, { k = 4 } = {}) {
  const category = draft?.meta?.category || draft?.category || null;
  const parts = [];
  const desc = draft?.description;
  if (desc) parts.push(cap(desc, 400));
  const rootCause = draft?.brokenState?.rootCause;
  if (rootCause) parts.push(rootCause);
  const title = draft?.meta?.name || draft?.title;
  if (title) parts.push(title);
  if (category) parts.push(category);

  const text = parts.filter(Boolean).join('\n').trim();
  if (!text) return { relatedLessons: [] };

  const hits = await findSimilar({ text, k, category });
  const sorted = hits
    .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
    .slice(0, k);

  return { relatedLessons: sorted.map(shapeLessonForPrompt) };
}

// ---------------------------------------------------------------------------
// findForRetry() — retry retrieval from iteration 2 onwards (unchanged logic)
// ---------------------------------------------------------------------------

async function findForRetry({ draft, spinFailureMsg, validateFailureMsg, k = LESSONS_K }) {
  const parts = [];
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
  const hits = await findSimilar({ text, k, category });
  const byId = new Map();
  for (const h of hits) byId.set(h.id, h);

  if (spinFailureMsg && validateFailureMsg) {
    const startHits = await findSimilar({
      text: [spinFailureMsg.message, spinFailureMsg.logs].filter(Boolean).join('\n'),
      k: Math.ceil(k / 2),
      phase: 'spin',
      category,
    });
    const valHits = await findSimilar({
      text: [validateFailureMsg.message, (validateFailureMsg.suggestions || []).join(' ')].join('\n'),
      k: Math.ceil(k / 2),
      phase: 'validate',
      category,
    });
    for (const h of [...startHits, ...valHits]) byId.set(h.id, h);
  }

  const merged = [...byId.values()]
    .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
    .slice(0, k);

  return { relatedLessons: merged.map(shapeLessonForPrompt) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToLesson(r) {
  return {
    id: r.id,
    type: r.type || 'fix',
    phase: r.phase,
    text: r.lesson_text,
    failureSummary: r.failure_summary,
    fixSummary: r.fix_summary,
    category: r.category,
    title: r.title,
    problemContext: r.problem_context,
    details: r.details,
    distance: r.distance != null ? Number(r.distance) : null,
  };
}

async function count() {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM lessons`);
  return rows[0]?.n || 0;
}

async function listPaginated({ page = 1, limit = 20, phase = null, category = null } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const where = [];
  const params = [];
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
    `SELECT id, type, phase, draft_session_id, build_session_id, category, title,
            problem_context, failure_summary, fix_summary, lesson_text, details, created_at
       FROM lessons
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${n} OFFSET $${n + 1}`,
    [...params, safeLimit, offset],
  );

  return {
    items: rows.map((r) => ({
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

async function backfillEmbeddings({ limit = 50 } = {}) {
  if (!llm.isEmbeddingConfigured()) return 0;
  let done = 0;
  try {
    const { rows } = await pool.query(
      `SELECT id, lesson_text FROM lessons WHERE embedding IS NULL ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    for (const r of rows) {
      const vec = await llm.embed(r.lesson_text);
      if (!vec) continue;
      await pool.query(`UPDATE lessons SET embedding = $1::vector WHERE id = $2`, [toPgVector(vec), r.id]);
      done += 1;
    }
  } catch (e) {
    console.warn(`[lessons] backfill failed: ${e.message}`);
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
