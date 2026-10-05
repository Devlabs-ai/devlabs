'use strict';

import type { ChallengeRow, ChallengePublic, ChallengeFull } from '../types/domain';

const pool = require('../db/pool');
const { publicBoardSpec, parseBoardSpec } = require('../workspace/boardGrade');
const { isClusterLabType } = require('./labTypes');

const cache = new Map<string, ChallengeFull>();

function publicFields(row: ChallengeRow): ChallengePublic {
  const { parseVisibleTo } = require('./access');
  const tokensRaw = Number(row.tokens ?? row.bounty);
  return {
    id: row.id,
    number: row.number ?? null,
    title: row.title,
    description: row.description,
    difficulty: row.difficulty,
    tags: row.tags || [],
    category: row.category,
    finalized: !!row.finalized,
    sandboxType: row.sandbox_type || null,
    visibleTo: parseVisibleTo(row.visible_to, 'admin'),
    visibilityNotes: String(row.visibility_notes || ''),
    tokens: Number.isFinite(tokensRaw) && tokensRaw >= 0 ? Math.trunc(tokensRaw) : 10,
  };
}

function fullFields(row: ChallengeRow): ChallengeFull {
  const platformSpec = row.platform_spec || null;
  const sandbox = row.sandbox_type || null;
  const boardSpec = sandbox === 'board' ? parseBoardSpec(platformSpec) : null;
  return {
    ...publicFields(row),
    verifiedDir: row.verified_dir || null,
    problemStatement: row.problem_statement || null,
    validationSpec: row.validation_spec || null,
    sparkPlatform: sandbox === 'spark-platform'
      ? (platformSpec as ChallengeFull['sparkPlatform'])
      : null,
    k8sPlatform: isClusterLabType(sandbox)
      ? (platformSpec as ChallengeFull['k8sPlatform'])
      : null,
    boardSpec,
  };
}

/**
 * Disk seed from sandbox/verified — disabled during catalog v2 redesign.
 * Legacy rows live in challenges_legacy; new rows via seedManualCatalog.
 */
async function seedChallengesFromDisk(verifiedRoot: string): Promise<void> {
  console.log(
    `[challenges] disk seed skipped (catalog v2); verified root would be ${verifiedRoot}`,
  );
}

async function loadChallengesFromDB(): Promise<Map<string, ChallengeFull>> {
  const { rows } = await pool.query(`SELECT * FROM challenges`);
  cache.clear();
  for (const row of rows) {
    cache.set(row.id, fullFields(row));
  }
  console.log(`[challenges] loaded ${cache.size} challenges`);
  return cache;
}

function getChallenge(id: string): ChallengeFull | null {
  return cache.get(id) || null;
}

function listChallenges(): ChallengeFull[] {
  return Array.from(cache.values());
}

function contentSourceOf(c: ChallengeFull): string | null {
  const fromPlatform = (c.sparkPlatform as { contentSource?: string } | null)?.contentSource;
  return fromPlatform || null;
}

function listPublicChallenges(): Record<string, unknown>[] {
  return listChallenges().map((c) => ({
    id: c.id,
    number: c.number ?? null,
    title: c.title,
    description: c.description,
    difficulty: c.difficulty,
    tags: c.tags,
    category: c.category,
    finalized: c.finalized,
    sandboxType: c.sandboxType,
    visibleTo: c.visibleTo || 'admin',
    visibilityNotes: c.visibilityNotes || '',
    tokens: typeof c.tokens === 'number' ? c.tokens : 10,
    contentSource: contentSourceOf(c),
    problemStatement: c.problemStatement,
    sparkPlatform: c.sparkPlatform || null,
    k8sPlatform: c.k8sPlatform || null,
    boardSpec: publicBoardSpec(c.boardSpec || null),
  }));
}

function getPublicChallenge(id: string): Record<string, unknown> | null {
  const c = getChallenge(id);
  if (!c) return null;
  return {
    id: c.id,
    number: c.number ?? null,
    title: c.title,
    description: c.description,
    difficulty: c.difficulty,
    tags: c.tags,
    category: c.category,
    finalized: c.finalized,
    sandboxType: c.sandboxType,
    visibleTo: c.visibleTo || 'admin',
    visibilityNotes: c.visibilityNotes || '',
    tokens: typeof c.tokens === 'number' ? c.tokens : 10,
    contentSource: contentSourceOf(c),
    verifiedDir: c.verifiedDir,
    problemStatement: c.problemStatement,
    validationSpec: c.validationSpec,
    sparkPlatform: c.sparkPlatform || null,
    k8sPlatform: c.k8sPlatform || null,
    boardSpec: publicBoardSpec(c.boardSpec || null),
  };
}

function putChallenge(full: ChallengeFull): void {
  cache.set(full.id, full);
}

function cacheFromRow(row: ChallengeRow): ChallengeFull {
  const full = fullFields(row);
  cache.set(full.id, full);
  return full;
}

function normalizeTokens(raw: unknown, fallback = 10): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(100000, Math.trunc(n));
}

async function setVisibleTo(
  challengeId: string,
  visibleTo: 'admin' | 'users' | 'reviewers',
  visibilityNotes?: string | null,
  tokens?: number | null,
): Promise<ChallengeFull | null> {
  const { parseVisibleTo } = require('./access');
  const audience = parseVisibleTo(visibleTo, 'admin');
  const notes = visibilityNotes != null ? String(visibilityNotes) : null;
  const tokensValue = tokens != null ? normalizeTokens(tokens) : null;

  let sql: string;
  let params: unknown[];
  if (notes != null && tokensValue != null) {
    sql = `UPDATE challenges
              SET visible_to = $1,
                  visibility_notes = $2,
                  tokens = $3,
                  bounty = $3,
                  updated_at = $4
            WHERE id = $5
            RETURNING *`;
    params = [audience, notes, tokensValue, Date.now(), challengeId];
  } else if (notes != null) {
    sql = `UPDATE challenges
              SET visible_to = $1,
                  visibility_notes = $2,
                  updated_at = $3
            WHERE id = $4
            RETURNING *`;
    params = [audience, notes, Date.now(), challengeId];
  } else if (tokensValue != null) {
    sql = `UPDATE challenges
              SET visible_to = $1,
                  tokens = $2,
                  bounty = $2,
                  updated_at = $3
            WHERE id = $4
            RETURNING *`;
    params = [audience, tokensValue, Date.now(), challengeId];
  } else {
    sql = `UPDATE challenges
              SET visible_to = $1,
                  updated_at = $2
            WHERE id = $3
            RETURNING *`;
    params = [audience, Date.now(), challengeId];
  }

  const { rows } = await pool.query(sql, params);
  if (!rows[0]) return null;
  return cacheFromRow(rows[0]);
}

module.exports = {
  seedChallengesFromDisk,
  loadChallengesFromDB,
  getChallenge,
  listChallenges,
  listPublicChallenges,
  getPublicChallenge,
  putChallenge,
  cacheFromRow,
  setVisibleTo,
};
