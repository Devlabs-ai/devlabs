'use strict';

import type { ChallengeDraft, DraftSession, BuildStatus, ValidationResult } from '../../types/domain';

const { v4: uuidv4 } = require('uuid');
const pool = require('../../db/pool');
const redis = require('../../cache/redis');
const { defaultShapeState, syncShapePhase } = require('../shape/shapeState');
const { stripInfraImplementation, repairSchemaFromMessages, storedServicesMissingImageHints } = require('../shape/shapeContract');
const { normalizeDraft, isDraftReady } = require('../draft/draftSchema');

const drafts = new Map<string, DraftSession>();

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

async function persist(d: DraftSession): Promise<void> {
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
        buildFailedDir: d.buildFailedDir || null,
        buildFailedSessionId: d.buildFailedSessionId || null,
        buildFailedPhase: d.buildFailedPhase || null,
        buildFailedMsg: d.buildFailedMsg || null,
      }),
      d.createdAt,
      d.updatedAt,
      d.authoredBy || null,
    ],
  );
}

async function restoreFromDB(): Promise<void> {
  const { rows } = await pool.query(`SELECT * FROM draft_sessions ORDER BY updated_at DESC LIMIT 200`);
  let restored = 0;
  for (const row of rows as Array<Record<string, unknown>>) {
    const meta = (row.build_logs as Record<string, unknown>) || {};
    const legacyPhase = (meta.shapePhase as string) || 'design';
    const shapePhase = legacyPhase === 'description' ? 'design' : legacyPhase;
    const designApproved = !!((meta.designApproved as boolean) ?? (meta.descriptionApproved as boolean));
    const d: DraftSession = {
      id: row.id as string,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
      authoredBy: (row.authored_by as string) || null,
      messages: Array.isArray(meta.messages) ? meta.messages as Array<{ role: string; content: string }> : [],
      shapePhase,
      designApproved,
      schemaMaterialized: !!(meta.schemaMaterialized as boolean),
      draft: (row.draft as ChallengeDraft) || null,
      testSessionId: null,
      buildStatus: (meta.buildStatus as BuildStatus) || null,
      buildSessionId: (meta.buildSessionId as string) || null,
      buildDir: (row.build_dir as string) || null,
      buildAttempts: (meta.buildAttempts as number) || 0,
      buildLogs: Array.isArray(meta.buildLogs) ? meta.buildLogs : [],
      buildChecklists: Array.isArray(meta.buildChecklists) ? meta.buildChecklists : [],
      buildLatestChecklist: meta.buildLatestChecklist || null,
      builtChallenge: (meta.builtChallenge as Record<string, unknown>) || null,
      buildValidation: (meta.buildValidation as (ValidationResult & { llmUsage?: unknown })) || null,
      buildCurrentPhase: (meta.buildCurrentPhase as string) || null,
      buildCurrentAttempt: (meta.buildCurrentAttempt as number) || 0,
      reviewFeedback: meta.reviewFeedback || null,
      buildFailedDir: (meta.buildFailedDir as string) || null,
      buildFailedSessionId: (meta.buildFailedSessionId as string) || null,
      buildFailedPhase: (meta.buildFailedPhase as string) || null,
      buildFailedMsg: (meta.buildFailedMsg as string) || null,
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
};
