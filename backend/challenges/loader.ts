'use strict';

import type { ChallengeRow, ChallengePublic, ChallengeFull } from '../types/domain';

const pool = require('../db/pool');

const cache = new Map<string, ChallengeFull>();

function publicFields(row: ChallengeRow): ChallengePublic {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    difficulty: row.difficulty,
    tags: row.tags || [],
    category: row.category,
    finalized: !!row.finalized,
    sandboxType: row.sandbox_type || null,
  };
}

function fullFields(row: ChallengeRow): ChallengeFull {
  const platformSpec = row.platform_spec || null;
  return {
    ...publicFields(row),
    verifiedDir: row.verified_dir || null,
    problemStatement: row.problem_statement || null,
    validationSpec: row.validation_spec || null,
    sparkPlatform: platformSpec
      ? (platformSpec as ChallengeFull['sparkPlatform'])
      : null,
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

function listPublicChallenges(): Record<string, unknown>[] {
  return listChallenges().map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    difficulty: c.difficulty,
    tags: c.tags,
    category: c.category,
    finalized: c.finalized,
    sandboxType: c.sandboxType,
    problemStatement: c.problemStatement,
    sparkPlatform: c.sparkPlatform || null,
  }));
}

function getPublicChallenge(id: string): Record<string, unknown> | null {
  const c = getChallenge(id);
  if (!c) return null;
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    difficulty: c.difficulty,
    tags: c.tags,
    category: c.category,
    finalized: c.finalized,
    sandboxType: c.sandboxType,
    verifiedDir: c.verifiedDir,
    problemStatement: c.problemStatement,
    validationSpec: c.validationSpec,
    sparkPlatform: c.sparkPlatform || null,
  };
}

module.exports = {
  seedChallengesFromDisk,
  loadChallengesFromDB,
  getChallenge,
  listChallenges,
  listPublicChallenges,
  getPublicChallenge,
};
