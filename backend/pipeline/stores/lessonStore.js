'use strict';

// Learned lessons from builds: recorded once when START or VALIDATE succeeds
// after one or more failures in that phase. Retrieved by semantic similarity
// on retry. Best-effort — never blocks a build.

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

function buildProblemContext(draft) {
  const parts = [];
  const title = draft?.title || draft?.sandboxSpec?.title;
  if (title) parts.push(`Title: ${title}`);
  const category = draft?.category || draft?.sandboxSpec?.category;
  if (category) parts.push(`Category: ${category}`);
  const broken = draft?.sandboxSpec?.brokenState;
  if (broken) parts.push(`Broken state: ${cap(broken, 800)}`);
  const desc = draft?.sandboxSpec?.description;
  if (desc) parts.push(`Description: ${cap(desc, 400)}`);
  return parts.join('\n') || 'Interview sandbox challenge';
}

function buildFailureSummary(failures) {
  return failures
    .map((f) => `Attempt ${f.attempt} (${f.phase}): ${f.message || '(no message)'}`)
    .join('\n');
}

function buildLessonText({ phase, category, failures, compose, validationFeedback }) {
  const phaseLabel = phase === 'start' ? 'START' : 'VALIDATE';
  const lines = [];
  lines.push(`${phaseLabel} phase succeeded${category ? ` for category ${category}` : ''}.`);
  lines.push(`Failures observed before this success (${failures.length}):`);
  for (const f of failures) {
    lines.push(`- Attempt ${f.attempt}: ${cap(f.message, 400)}`);
  }
  if (validationFeedback) {
    lines.push(`Final validation note: ${cap(validationFeedback, 400)}`);
  }
  lines.push('Working compose configuration that resolved the issue:');
  lines.push(cap(compose, 2200));
  return lines.join('\n');
}

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
}) {
  if (!failures || failures.length === 0) return null;
  if (phase !== 'start' && phase !== 'validate') return null;

  const compose = assets?.dockerCompose || '';
  const problem_context = buildProblemContext(draft);
  const failure_summary = buildFailureSummary(failures);
  const fix_summary = phase === 'start'
    ? 'Docker compose stack reached a healthy running state.'
    : 'Validation steps confirmed the broken state is observable in the sandbox.';
  const lesson_text = buildLessonText({
    phase,
    category,
    failures,
    compose,
    validationFeedback,
  });

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
          workingCompose: cap(compose, 3500),
          validationFeedback,
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

async function findSimilar({ text, k = LESSONS_K, maxDistance = LESSONS_MAX_DISTANCE, phase = null, category = null }) {
  if (!text) return [];
  const vec = await llm.embed(text);
  if (!vec) return [];
  const pgVec = toPgVector(vec);
  try {
    const params = [pgVec, maxDistance, k];
    let sql = `SELECT id, phase, lesson_text, failure_summary, fix_summary, details, category,
                      title, problem_context,
                      (embedding <=> $1::vector) AS distance
                 FROM lessons
                WHERE embedding IS NOT NULL
                  AND (embedding <=> $1::vector) <= $2`;
    let n = 3;
    if (phase) {
      sql += ` AND phase = $${n}`;
      params.push(phase);
      n += 1;
    }
    if (category) {
      sql += ` AND (category = $${n} OR category IS NULL)`;
      params.push(category);
      n += 1;
    }
    sql += ` ORDER BY embedding <=> $1::vector LIMIT $3`;
    const { rows } = await pool.query(sql, params);
    return rows.map(rowToLesson);
  } catch (e) {
    console.warn(`[lessons] findSimilar failed: ${e.message}`);
    return [];
  }
}

function shapeLessonForPrompt(lesson) {
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

async function findForRetry({ draft, startFailureMsg, validateFailureMsg, k = LESSONS_K }) {
  const parts = [];
  if (startFailureMsg) {
    parts.push(startFailureMsg.message || '');
    parts.push(startFailureMsg.composeStderr || '');
    parts.push(startFailureMsg.logs || '');
  }
  if (validateFailureMsg) {
    parts.push(validateFailureMsg.message || '');
    if (Array.isArray(validateFailureMsg.suggestions)) {
      parts.push(validateFailureMsg.suggestions.join(' '));
    }
  }
  const text = parts.filter(Boolean).join('\n').trim();
  if (!text) return { relatedLessons: [] };

  const category = draft?.category || draft?.sandboxSpec?.category || null;
  const hits = await findSimilar({ text, k, category });
  const byId = new Map();
  for (const h of hits) byId.set(h.id, h);

  if (startFailureMsg && validateFailureMsg) {
    const startHits = await findSimilar({
      text: [startFailureMsg.message, startFailureMsg.logs].filter(Boolean).join('\n'),
      k: Math.ceil(k / 2),
      phase: 'start',
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

  return {
    relatedLessons: merged.map(shapeLessonForPrompt),
  };
}

function rowToLesson(r) {
  return {
    id: r.id,
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

  if (phase === 'start' || phase === 'validate') {
    where.push(`phase = $${n}`);
    params.push(phase);
    n += 1;
  }
  if (category) {
    where.push(`category = $${n}`);
    params.push(category);
    n += 1;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM lessons ${whereSql}`,
    params,
  );
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
    items: rows.map((r) => ({
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

async function backfillEmbeddings({ limit = 50 } = {}) {
  if (!llm.isEmbeddingConfigured()) return 0;
  let done = 0;
  try {
    const { rows } = await pool.query(
      `SELECT id, lesson_text FROM lessons
         WHERE embedding IS NULL
         ORDER BY created_at DESC
         LIMIT $1`,
      [limit],
    );
    for (const r of rows) {
      const vec = await llm.embed(r.lesson_text);
      if (!vec) continue;
      await pool.query(
        `UPDATE lessons SET embedding = $1::vector WHERE id = $2`,
        [toPgVector(vec), r.id],
      );
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
  findSimilar,
  count,
  listPaginated,
  backfillEmbeddings,
  buildProblemContext,
};
