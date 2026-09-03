#!/usr/bin/env npx tsx
/**
 * Upsert a thin catalog row into Postgres `challenges`.
 *
 * Authoring SSOT for MinIO-backed labs:
 *   platforms/devlabs-data/challenges/<id>/challenge/challenge.json
 *
 * Fallback (legacy):
 *   backend/challenges/packs/<id>.json
 *
 * Usage:
 *   DEVLABS_DATA_ROOT=../platforms/devlabs-data \
 *     npx tsx scripts/registerChallengePack.ts --id l1-filter-valid-sales-rows
 *   npx tsx scripts/registerChallengePack.ts --all
 */
'use strict';

import fs from 'fs';
import path from 'path';

require('dotenv').config({ override: true });

const pool = require('../db/pool');

interface ChallengePack {
  id: string;
  /** Global catalog number across all platforms (1, 2, 3, …). */
  number?: number | null;
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
  category: string;
  sandboxType: string;
  finalized?: boolean;
  contentSource?: string;
  problemStatement: Record<string, unknown>;
  platformSpec: Record<string, unknown>;
  play?: { domainId?: string; panelId?: string };
  dataGen?: Record<string, unknown>;
}

const PACKS_DIR = path.join(__dirname, '../challenges/packs');

function resolveDataRoot(): string | null {
  const fromEnv = process.env.DEVLABS_DATA_ROOT;
  if (fromEnv && fs.existsSync(fromEnv)) return path.resolve(fromEnv);
  // backend/scripts → ../../.. = org root (devlabs-ai/) when sibling checkouts
  const sibling = path.resolve(__dirname, '../../../platforms/devlabs-data');
  if (fs.existsSync(sibling)) return sibling;
  return null;
}

function playgroundMetaPath(dataRoot: string, id: string): string {
  return path.join(dataRoot, 'challenges', id, 'challenge', 'challenge.json');
}

function listPackFiles(): string[] {
  if (!fs.existsSync(PACKS_DIR)) return [];
  return fs
    .readdirSync(PACKS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(PACKS_DIR, f))
    .sort();
}

function listPlaygroundIds(dataRoot: string): string[] {
  const root = path.join(dataRoot, 'challenges');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => fs.existsSync(playgroundMetaPath(dataRoot, name)))
    .sort();
}

function loadPack(filePath: string): ChallengePack {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ChallengePack;
  if (!raw.id || !raw.title || !raw.sandboxType || !raw.platformSpec) {
    throw new Error(`Invalid pack (missing required fields): ${filePath}`);
  }
  return raw;
}

function toThinCatalog(c: ChallengePack): ChallengePack {
  const contentSource =
    c.contentSource
    || (c.platformSpec as { contentSource?: string }).contentSource
    || undefined;
  const platformSpec = {
    ...c.platformSpec,
    ...(contentSource ? { contentSource } : {}),
  };
  return {
    ...c,
    contentSource,
    platformSpec,
    // Keep problemStatement in DB as a cache/fallback; Play prefers MinIO when contentSource=minio.
    problemStatement: c.problemStatement || {},
  };
}

async function upsertPack(c: ChallengePack): Promise<void> {
  const thin = toThinCatalog(c);
  const now = Date.now();
  const number =
    typeof thin.number === 'number' && Number.isFinite(thin.number)
      ? Math.trunc(thin.number)
      : null;
  await pool.query(
    `INSERT INTO challenges
       (id, number, title, description, difficulty, tags, category,
        finalized, sandbox_type, verified_dir,
        problem_statement, validation_spec, platform_spec,
        created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,NULL,$11,$12,$12)
     ON CONFLICT (id) DO UPDATE SET
       number = EXCLUDED.number,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       difficulty = EXCLUDED.difficulty,
       tags = EXCLUDED.tags,
       category = EXCLUDED.category,
       finalized = EXCLUDED.finalized,
       sandbox_type = EXCLUDED.sandbox_type,
       problem_statement = EXCLUDED.problem_statement,
       platform_spec = EXCLUDED.platform_spec,
       updated_at = EXCLUDED.updated_at`,
    [
      thin.id,
      number,
      thin.title,
      thin.description,
      thin.difficulty,
      JSON.stringify(thin.tags || []),
      thin.category,
      thin.finalized === true,
      thin.sandboxType,
      JSON.stringify(thin.problemStatement || {}),
      JSON.stringify(thin.platformSpec || {}),
      now,
    ],
  );
  const src = thin.contentSource === 'minio' ? 'minio-ssot' : 'pack';
  console.log(
    `[register] upserted challenge "${thin.id}" number=${number ?? '—'} (${src})`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const idFlag = args.indexOf('--id');
  const id = idFlag >= 0 ? args[idFlag + 1] : null;

  if (!all && !id) {
    console.error('Usage: registerChallengePack.ts --id <challenge-id> | --all');
    process.exit(1);
  }

  const dataRoot = resolveDataRoot();

  if (!all && id) {
    const playground = dataRoot ? playgroundMetaPath(dataRoot, id) : null;
    if (playground && fs.existsSync(playground)) {
      console.log(`[register] using playground meta ${playground}`);
      await upsertPack(loadPack(playground));
      await pool.end?.();
      return;
    }
    const packFile = path.join(PACKS_DIR, `${id}.json`);
    if (!fs.existsSync(packFile)) {
      console.error(`No playground challenge.json or pack for id=${id}`);
      process.exit(1);
    }
    console.log(`[register] using pack ${packFile}`);
    await upsertPack(loadPack(packFile));
    await pool.end?.();
    return;
  }

  // --all: playground ids first, then leftover packs
  const seen = new Set<string>();
  if (dataRoot) {
    for (const pid of listPlaygroundIds(dataRoot)) {
      const meta = playgroundMetaPath(dataRoot, pid);
      console.log(`[register] using playground meta ${meta}`);
      await upsertPack(loadPack(meta));
      seen.add(pid);
    }
  }
  for (const file of listPackFiles()) {
    const pack = loadPack(file);
    if (seen.has(pack.id)) continue;
    console.log(`[register] using pack ${file}`);
    await upsertPack(pack);
  }

  await pool.end?.();
}

main().catch((err: Error) => {
  console.error('[register] failed:', err.message);
  process.exit(1);
});
