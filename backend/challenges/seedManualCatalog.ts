'use strict';

/**
 * Challenge catalog seed (v2).
 * Packs: backend/challenges/packs/*.json
 */

const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

interface CatalogRow {
  id: string;
  number?: number | null;
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
  category: string;
  sandboxType: string;
  finalized: boolean;
  problemStatement: Record<string, unknown>;
  platformSpec: Record<string, unknown>;
  visibleTo: string | null;
  tokens: number | null;
}

const VISIBLE_TO = new Set(['admin', 'reviewers', 'users']);

function loadPackRows(): CatalogRow[] {
  const packsDir = path.join(__dirname, 'packs');
  if (!fs.existsSync(packsDir)) return [];
  return fs
    .readdirSync(packsDir)
    .filter((f: string) => f.endsWith('.json') && !f.startsWith('_'))
    .sort()
    .map((f: string) => {
      const raw = JSON.parse(fs.readFileSync(path.join(packsDir, f), 'utf8'));
      return {
        id: raw.id,
        number: typeof raw.number === 'number' ? raw.number : null,
        title: raw.title,
        description: raw.description,
        difficulty: raw.difficulty,
        tags: raw.tags || [],
        category: raw.category,
        sandboxType: raw.sandboxType,
        finalized: raw.finalized === true,
        problemStatement: raw.problemStatement || {},
        platformSpec: raw.platformSpec || {},
        visibleTo: VISIBLE_TO.has(raw.visibleTo) ? raw.visibleTo : null,
        tokens:
          typeof raw.tokens === 'number' && Number.isFinite(raw.tokens) && raw.tokens >= 0
            ? Math.trunc(raw.tokens)
            : null,
      } as CatalogRow;
    })
    .filter((row: CatalogRow) => Boolean(row.id && row.title && row.sandboxType));
}

async function upsertChallenge(c: CatalogRow): Promise<void> {
  const now = Date.now();
  const number =
    typeof c.number === 'number' && Number.isFinite(c.number)
      ? Math.trunc(c.number)
      : null;
  // Pack `visibleTo` / `tokens` win on every boot; without them new labs start
  // admin-only with 10 tokens and existing rows keep their DB values.
  const defaultVisibleTo = c.visibleTo ?? 'admin';
  const defaultTokens = c.tokens ?? 10;
  await pool.query(
    `INSERT INTO challenges
       (id, number, title, description, difficulty, tags, category,
        finalized, sandbox_type, verified_dir,
        problem_statement, validation_spec, platform_spec,
        visible_to, tokens, bounty,
        created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,NULL,$11,$12,$14,$14,$13,$13)
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
       visible_to = CASE WHEN $15::boolean THEN EXCLUDED.visible_to ELSE challenges.visible_to END,
       tokens = CASE WHEN $16::boolean THEN EXCLUDED.tokens ELSE challenges.tokens END,
       bounty = CASE WHEN $16::boolean THEN EXCLUDED.bounty ELSE challenges.bounty END,
       updated_at = EXCLUDED.updated_at`,
    [
      c.id,
      number,
      c.title,
      c.description,
      c.difficulty,
      JSON.stringify(c.tags),
      c.category,
      c.finalized,
      c.sandboxType,
      JSON.stringify(c.problemStatement),
      JSON.stringify(c.platformSpec),
      defaultVisibleTo,
      now,
      defaultTokens,
      c.visibleTo != null,
      c.tokens != null,
    ],
  );
  console.log(`[challenges] catalog upserted "${c.id}" number=${number ?? '—'}`);
}

async function seedManualCatalog(): Promise<void> {
  const keepIds = new Set(loadPackRows().map((r) => r.id));
  const byId = new Map<string, CatalogRow>();
  for (const row of loadPackRows()) byId.set(row.id, row);

  for (const row of byId.values()) {
    await upsertChallenge(row);
  }

  // Drop catalog rows that are no longer in packs (e.g. retired inline seeds).
  if (keepIds.size > 0) {
    const result = await pool.query(
      `DELETE FROM challenges WHERE id <> ALL($1::text[]) RETURNING id`,
      [[...keepIds]],
    );
    for (const row of result.rows || []) {
      console.log(`[challenges] catalog removed "${row.id}"`);
    }
  }

  // Keep the in-memory Play cache in sync with packs (otherwise Description/Theory
  // stay stale until the next process restart).
  try {
    const loader = require('./loader');
    if (typeof loader.loadChallengesFromDB === 'function') {
      await loader.loadChallengesFromDB();
    }
  } catch (e: unknown) {
    console.warn(
      '[challenges] cache reload after seed skipped:',
      (e as Error).message,
    );
  }
}

module.exports = { seedManualCatalog, loadPackRows };
