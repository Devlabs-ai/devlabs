'use strict';

import type { ChallengeDraft, DraftSession, BuildStatus, ValidationResult } from '../../types/domain';

const { v4: uuidv4 } = require('uuid');
const pool = require('../../db/pool');
const redis = require('../../cache/redis');
const { defaultShapeState, syncShapePhase } = require('../shape/shapeState');
const { stripInfraImplementation, repairSchemaFromMessages, storedServicesMissingImageHints } = require('../shape/shapeContract');
const { normalizeDraft, isDraftReady } = require('../draft/draftSchema');
const { loadLatestBuildFailure } = require('../build/buildFailureRecord');

const drafts = new Map<string, DraftSession>();
const MAX_PIPELINE_LOGS = 1000;

function makeDraft({
  id = uuidv4(),
  draft = null,
  shapePhase,
  designApproved,
  schemaMaterialized,
  authoredBy = null,
}: {
  id?: string;
  draft?: ChallengeDraft | null;
  shapePhase?: string;
  designApproved?: boolean;
  schemaMaterialized?: boolean;
  authoredBy?: string | null;
} = {}): DraftSession {
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
    buildStatus: null,
    buildSessionId: null,
    buildDir: null,
    buildAttempts: 0,
    buildLogs: [],
    builtChallenge: null,
    buildValidation: null,
    buildCurrentPhase: null,
    buildCurrentAttempt: 0,
    reviewFeedback: null,
    buildFailedDir: null,
    buildFailedSessionId: null,
    buildFailedPhase: null,
    buildFailedMsg: null,
  };
}

function get(id: string): DraftSession | null {
  return drafts.get(id) || null;
}

function set(id: string, d: DraftSession): DraftSession {
  d.updatedAt = Date.now();
  drafts.set(id, d);
  return d;
}

function list(authoredBy: string | null = null): DraftSession[] {
  const all = Array.from(drafts.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!authoredBy) return all;
  return all.filter((d) => d.authoredBy === authoredBy);
}

/** Fill buildLogs from disk failure record when DB has none (legacy / post-migration gap). */
function hydrateBuildLogsIfNeeded(d: DraftSession): void {
  if (Array.isArray(d.buildLogs) && d.buildLogs.length > 0) return;
  const failDir = d.buildFailedDir || d.buildDir;
  if (!failDir) return;
  const failure = loadLatestBuildFailure(failDir);
  if (!failure) return;
  const lines: string[] = [];
  if (failure.phase || failure.message) {
    lines.push(`Build failed at ${failure.phase || 'unknown'}: ${failure.message || ''}`);
  }
  if (Array.isArray(failure.lastLogs) && failure.lastLogs.length > 0) {
    if (lines.length) lines.push('---');
    lines.push(...failure.lastLogs);
  }
  if (lines.length > 0) d.buildLogs = lines;
}

async function persist(d: DraftSession): Promise<void> {
  await pool.query(
    `INSERT INTO draft_sessions (
       id, draft, build_dir, created_at, updated_at, authored_by,
       build_status, build_session_id, build_failed_dir, build_failed_session_id,
       build_failed_phase, build_failed_msg, build_current_phase, build_current_attempt, build_attempts
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (id) DO UPDATE SET
       draft = EXCLUDED.draft,
       build_dir = EXCLUDED.build_dir,
       updated_at = EXCLUDED.updated_at,
       authored_by = COALESCE(draft_sessions.authored_by, EXCLUDED.authored_by),
       build_status = EXCLUDED.build_status,
       build_session_id = EXCLUDED.build_session_id,
       build_failed_dir = EXCLUDED.build_failed_dir,
       build_failed_session_id = EXCLUDED.build_failed_session_id,
       build_failed_phase = EXCLUDED.build_failed_phase,
       build_failed_msg = EXCLUDED.build_failed_msg,
       build_current_phase = EXCLUDED.build_current_phase,
       build_current_attempt = EXCLUDED.build_current_attempt,
       build_attempts = EXCLUDED.build_attempts`,
    [
      d.id,
      d.draft ? JSON.stringify(d.draft) : null,
      d.buildDir || null,
      d.createdAt,
      d.updatedAt,
      d.authoredBy || null,
      d.buildStatus || null,
      d.buildSessionId || null,
      d.buildFailedDir || null,
      d.buildFailedSessionId || null,
      d.buildFailedPhase || null,
      d.buildFailedMsg || null,
      d.buildCurrentPhase || null,
      d.buildCurrentAttempt || 0,
      d.buildAttempts || 0,
    ],
  );
  await pool.query(
    `INSERT INTO draft_session_meta (
       session_id, messages, shape_phase, design_approved, schema_materialized,
       build_checklists, build_latest_checklist, built_challenge, build_validation, review_feedback,
       pipeline_logs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (session_id) DO UPDATE SET
       messages = EXCLUDED.messages,
       shape_phase = EXCLUDED.shape_phase,
       design_approved = EXCLUDED.design_approved,
       schema_materialized = EXCLUDED.schema_materialized,
       build_checklists = EXCLUDED.build_checklists,
       build_latest_checklist = EXCLUDED.build_latest_checklist,
       built_challenge = EXCLUDED.built_challenge,
       build_validation = EXCLUDED.build_validation,
       review_feedback = EXCLUDED.review_feedback,
       pipeline_logs = EXCLUDED.pipeline_logs`,
    [
      d.id,
      JSON.stringify(d.messages || []),
      d.shapePhase,
      !!d.designApproved,
      !!d.schemaMaterialized,
      JSON.stringify(d.buildChecklists || []),
      d.buildLatestChecklist ? JSON.stringify(d.buildLatestChecklist) : null,
      d.builtChallenge ? JSON.stringify(d.builtChallenge) : null,
      d.buildValidation ? JSON.stringify(d.buildValidation) : null,
      d.reviewFeedback ? JSON.stringify(d.reviewFeedback) : null,
      JSON.stringify((d.buildLogs || []).slice(-MAX_PIPELINE_LOGS)),
    ],
  );
}

async function restoreFromDB(): Promise<void> {
  const { rows } = await pool.query(`
    SELECT
      ds.*,
      m.messages AS meta_messages,
      m.shape_phase AS meta_shape_phase,
      m.design_approved AS meta_design_approved,
      m.schema_materialized AS meta_schema_materialized,
      m.build_checklists AS meta_build_checklists,
      m.build_latest_checklist AS meta_build_latest_checklist,
      m.built_challenge AS meta_built_challenge,
      m.build_validation AS meta_build_validation,
      m.review_feedback AS meta_review_feedback,
      m.pipeline_logs AS meta_pipeline_logs
    FROM draft_sessions ds
    LEFT JOIN draft_session_meta m ON m.session_id = ds.id
    ORDER BY ds.updated_at DESC
    LIMIT 200
  `);
  let restored = 0;
  for (const row of rows as Array<Record<string, unknown>>) {
    const legacyPhase = (row.meta_shape_phase as string) || 'design';
    const shapePhase = legacyPhase === 'description' ? 'design' : legacyPhase;
    const d: DraftSession = {
      id: row.id as string,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
      authoredBy: (row.authored_by as string) || null,
      messages: Array.isArray(row.meta_messages)
        ? row.meta_messages as Array<{ role: string; content: string }>
        : [],
      shapePhase,
      designApproved: !!(row.meta_design_approved as boolean),
      schemaMaterialized: !!(row.meta_schema_materialized as boolean),
      draft: (row.draft as ChallengeDraft) || null,
      testSessionId: null,
      buildStatus: (row.build_status as BuildStatus) || null,
      buildSessionId: (row.build_session_id as string) || null,
      buildDir: (row.build_dir as string) || null,
      buildAttempts: Number(row.build_attempts) || 0,
      buildLogs: Array.isArray(row.meta_pipeline_logs)
        ? row.meta_pipeline_logs as string[]
        : [],
      buildChecklists: Array.isArray(row.meta_build_checklists) ? row.meta_build_checklists : [],
      buildLatestChecklist: row.meta_build_latest_checklist || null,
      builtChallenge: (row.meta_built_challenge as Record<string, unknown>) || null,
      buildValidation: (row.meta_build_validation as (ValidationResult & { llmUsage?: unknown })) || null,
      buildCurrentPhase: (row.build_current_phase as string) || null,
      buildCurrentAttempt: Number(row.build_current_attempt) || 0,
      reviewFeedback: row.meta_review_feedback || null,
      buildFailedDir: (row.build_failed_dir as string) || null,
      buildFailedSessionId: (row.build_failed_session_id as string) || null,
      buildFailedPhase: (row.build_failed_phase as string) || null,
      buildFailedMsg: (row.build_failed_msg as string) || null,
    };
    const persistedPhase = legacyPhase;
    if (d.draft?.infra && !d.schemaMaterialized) {
      d.draft = { ...d.draft, infra: stripInfraImplementation(d.draft.infra) };
    }
    syncShapePhase(d);
    let healed: boolean = repairSchemaFromMessages(d);
    if (!healed && d.schemaMaterialized && d.draft && storedServicesMissingImageHints(d.draft)) {
      const normalized = normalizeDraft(d.draft);
      if (isDraftReady(normalized)) {
        d.draft = normalized;
        syncShapePhase(d);
        healed = true;
      }
    }
    hydrateBuildLogsIfNeeded(d);
    drafts.set(d.id, d);
    if (healed || persistedPhase !== d.shapePhase || (persistedPhase === 'ready' && !d.schemaMaterialized)) {
      // eslint-disable-next-line no-await-in-loop
      await persist(d);
    }
    restored += 1;
  }
  console.log(`[drafts] restored ${restored} draft sessions from db`);
}

async function remove(id: string): Promise<void> {
  drafts.delete(id);
  await pool.query(`DELETE FROM draft_sessions WHERE id = $1`, [id]);
}

async function snapshotBuildState(d: DraftSession | null | undefined): Promise<void> {
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
  hydrateBuildLogsIfNeeded,
};
