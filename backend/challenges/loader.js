'use strict';

const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { normalizeBucket } = require('./buckets');

const cache = new Map();

function publicFields(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    difficulty: row.difficulty,
    tags: row.tags || [],
    category: row.category,
    bucket: row.bucket || null,
    finalized: !!row.finalized,
    sandboxType: row.sandbox_type || null,
  };
}

function fullFields(row) {
  return {
    ...publicFields(row),
    verifiedDir: row.verified_dir || null,
    problemStatement: row.problem_statement || null,
    validationSpec: row.validation_spec || null,
  };
}

async function seedChallengesFromDisk(verifiedRoot) {
  if (!fs.existsSync(verifiedRoot)) {
    console.log(`[challenges] no verified dir at ${verifiedRoot}, skipping seed`);
    return;
  }

  const entries = fs.readdirSync(verifiedRoot, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const slug = ent.name;
    const challengeFile = path.join(verifiedRoot, slug, 'challenge.json');
    if (!fs.existsSync(challengeFile)) continue;

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(challengeFile, 'utf8'));
    } catch (e) {
      console.warn(`[challenges] failed to parse ${challengeFile}: ${e.message}`);
      continue;
    }

    const verifiedDir = path.resolve(verifiedRoot, slug);
    const id = parsed.id || slug;
    const now = Date.now();

    await pool.query(
      `INSERT INTO challenges
        (id, title, description, difficulty, tags, category, bucket, finalized,
         sandbox_type, verified_dir, problem_statement, validation_spec,
         created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         difficulty = EXCLUDED.difficulty,
         tags = EXCLUDED.tags,
         category = EXCLUDED.category,
         bucket = EXCLUDED.bucket,
         finalized = EXCLUDED.finalized,
         sandbox_type = EXCLUDED.sandbox_type,
         verified_dir = EXCLUDED.verified_dir,
         problem_statement = EXCLUDED.problem_statement,
         validation_spec = EXCLUDED.validation_spec,
         updated_at = EXCLUDED.updated_at`,
      [
        id,
        parsed.title || slug,
        parsed.description || '',
        parsed.difficulty || 'Medium',
        JSON.stringify(parsed.tags || []),
        parsed.category || 'General',
        normalizeBucket(parsed.bucket),
        parsed.finalized != null ? !!parsed.finalized : true,
        parsed.sandboxType || null,
        verifiedDir,
        parsed.problemStatement || null,
        parsed.validationSpec || null,
        now,
      ],
    );

    console.log(`[challenges] seeded "${id}" from ${verifiedDir}`);
  }
}

async function loadChallengesFromDB() {
  const { rows } = await pool.query(`SELECT * FROM challenges`);
  cache.clear();
  for (const row of rows) {
    cache.set(row.id, fullFields(row));
  }
  console.log(`[challenges] loaded ${cache.size} challenges`);
  return cache;
}

function getChallenge(id) {
  return cache.get(id) || null;
}

function listChallenges() {
  return Array.from(cache.values());
}

function listPublicChallenges() {
  return listChallenges().map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    difficulty: c.difficulty,
    tags: c.tags,
    category: c.category,
    bucket: c.bucket || null,
    finalized: c.finalized,
    sandboxType: c.sandboxType,
  }));
}

function getPublicChallenge(id) {
  const c = getChallenge(id);
  if (!c) return null;
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    difficulty: c.difficulty,
    tags: c.tags,
    category: c.category,
    bucket: c.bucket || null,
    finalized: c.finalized,
    sandboxType: c.sandboxType,
    problemStatement: c.problemStatement,
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
