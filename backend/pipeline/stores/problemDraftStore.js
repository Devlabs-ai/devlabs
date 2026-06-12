'use strict';

// Problem-Setter draft session store.
// Mirrors `db/sessionStore` but for the authoring side: each draft session
// carries chat history, a draft challenge JSON, and live build pipeline state.
//
// Storage:
//   - in-memory Map (hot state)
//   - Postgres `draft_sessions` table (durable; id, draft JSONB, build_dir, build_logs JSONB)
//   - Redis (transient build state: status / phase / attempt / dir / logs)

const { v4: uuidv4 } = require('uuid');
const pool = require('../../db/pool');
const redis = require('../../cache/redis');
const { defaultShapeState, syncShapePhase } = require('../shape/shapeState');
const { stripInfraImplementation, repairSchemaFromMessages, storedServicesMissingImageHints } = require('../shape/shapeContract');
const { normalizeDraft, isDraftReady } = require('../draft/draftSchema');

// id -> draft session object
const drafts = new Map();

function makeDraft({ id = uuidv4(), draft = null, shapePhase, designApproved, schemaMaterialized, authoredBy = null } = {}) {
  const shape = defaultShapeState();
  return {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    authoredBy,
    messages: [],
    draft,
    shapePhase: shapePhase || shape.shapePhase,
    designApproved: designApproved ?? shape.designApproved,
    schemaMaterialized: schemaMaterialized ?? shape.schemaMaterialized,
    testSessionId: null,
    buildStatus: null,        // null | 'building' | 'review_ready' | 'failed'
    buildSessionId: null,     // sandbox/builds/<buildId> identifier
    buildDir: null,
    buildAttempts: 0,
    buildLogs: [],
    builtChallenge: null,
    buildValidation: null,
    buildCurrentPhase: null,
    buildCurrentAttempt: 0,
    reviewFeedback: null,
  };
}

function get(id) {
  return drafts.get(id) || null;
}

function set(id, d) {
  d.updatedAt = Date.now();
  drafts.set(id, d);
  return d;
}

function list(authoredBy = null) {
  const all = Array.from(drafts.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!authoredBy) return all;
  return all.filter((d) => d.authoredBy === authoredBy);
}

async function persist(d) {
  await pool.query(
    `INSERT INTO draft_sessions (id, draft, build_dir, build_logs, created_at, updated_at, authored_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       draft = EXCLUDED.draft,
       build_dir = EXCLUDED.build_dir,
       build_logs = EXCLUDED.build_logs,
       updated_at = EXCLUDED.updated_at,
       authored_by = COALESCE(draft_sessions.authored_by, EXCLUDED.authored_by)`,
    [
      d.id,
      d.draft ? JSON.stringify(d.draft) : null,
      d.buildDir || null,
      JSON.stringify({
        messages: d.messages || [],
        shapePhase: d.shapePhase,
        designApproved: d.designApproved,
        schemaMaterialized: d.schemaMaterialized,
        buildStatus: d.buildStatus,
        buildSessionId: d.buildSessionId,
        buildAttempts: d.buildAttempts,
        buildLogs: d.buildLogs || [],
        buildChecklists: d.buildChecklists || [],
        buildLatestChecklist: d.buildLatestChecklist || null,
        builtChallenge: d.builtChallenge,
        buildValidation: d.buildValidation,
        buildCurrentPhase: d.buildCurrentPhase,
        buildCurrentAttempt: d.buildCurrentAttempt,
        reviewFeedback: d.reviewFeedback || null,
      }),
      d.createdAt,
      d.updatedAt,
      d.authoredBy || null,
    ],
  );
}

async function restoreFromDB() {
  const { rows } = await pool.query(`SELECT * FROM draft_sessions ORDER BY updated_at DESC LIMIT 200`);
  let restored = 0;
  for (const row of rows) {
    const meta = row.build_logs || {};
    // Back-compat: legacy drafts persisted shapePhase as 'description' and the
    // boolean as descriptionApproved. Normalize to the new 'design' names on
    // load; the next persist() write-back updates the row in place.
    const legacyPhase = meta.shapePhase || 'design';
    const shapePhase = legacyPhase === 'description' ? 'design' : legacyPhase;
    const designApproved = !!(meta.designApproved ?? meta.descriptionApproved);
    const d = {
      id: row.id,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
      authoredBy: row.authored_by || null,
      messages: Array.isArray(meta.messages) ? meta.messages : [],
      shapePhase,
      designApproved,
      schemaMaterialized: !!meta.schemaMaterialized,
      draft: row.draft || null,
      testSessionId: null,
      buildStatus: meta.buildStatus || null,
      buildSessionId: meta.buildSessionId || null,
      buildDir: row.build_dir || null,
      buildAttempts: meta.buildAttempts || 0,
      buildLogs: Array.isArray(meta.buildLogs) ? meta.buildLogs : [],
      buildChecklists: Array.isArray(meta.buildChecklists) ? meta.buildChecklists : [],
      buildLatestChecklist: meta.buildLatestChecklist || null,
      builtChallenge: meta.builtChallenge || null,
      buildValidation: meta.buildValidation || null,
      buildCurrentPhase: meta.buildCurrentPhase || null,
      buildCurrentAttempt: meta.buildCurrentAttempt || 0,
      reviewFeedback: meta.reviewFeedback || null,
    };
    // Use the raw on-disk phase (pre-normalization) so the diff at the bottom
    // re-persists drafts whose stored phase was the legacy 'description'.
    const persistedPhase = legacyPhase;
    if (d.draft?.infra && !d.schemaMaterialized) {
      d.draft = { ...d.draft, infra: stripInfraImplementation(d.draft.infra) };
    }
    syncShapePhase(d);
    let healed = repairSchemaFromMessages(d);
    if (!healed && d.schemaMaterialized && d.draft && storedServicesMissingImageHints(d.draft)) {
      const normalized = normalizeDraft(d.draft);
      if (isDraftReady(normalized)) {
        d.draft = normalized;
        syncShapePhase(d);
        healed = true;
      }
    }
    drafts.set(d.id, d);
    if (healed || persistedPhase !== d.shapePhase || (persistedPhase === 'ready' && !d.schemaMaterialized)) {
      // eslint-disable-next-line no-await-in-loop
      await persist(d);
    }
    restored += 1;
  }
  console.log(`[drafts] restored ${restored} draft sessions from db`);
}

async function remove(id) {
  drafts.delete(id);
  await pool.query(`DELETE FROM draft_sessions WHERE id = $1`, [id]);
}

// --- redis snapshots for live build watchers -----------------------------

async function snapshotBuildState(d) {
  if (!d) return;
  if (d.buildStatus) await redis.setBuildStatus(d.id, d.buildStatus);
  if (d.buildCurrentPhase) await redis.setBuildPhase(d.id, d.buildCurrentPhase);
  if (typeof d.buildCurrentAttempt === 'number') {
    await redis.setBuildAttempt(d.id, d.buildCurrentAttempt);
  }
  if (d.buildDir) await redis.setBuildDir(d.id, d.buildDir);
}

module.exports = {
  makeDraft,
  get,
  set,
  list,
  persist,
  remove,
  restoreFromDB,
  snapshotBuildState,
};
