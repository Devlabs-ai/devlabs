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
}

function loadPackRows(): CatalogRow[] {
  const packsDir = path.join(__dirname, 'packs');
  if (!fs.existsSync(packsDir)) return [];
  return fs
    .readdirSync(packsDir)
    .filter((f: string) => f.endsWith('.json'))
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
      } as CatalogRow;
    });
}

async function upsertChallenge(c: CatalogRow): Promise<void> {
  const now = Date.now();
  const number =
    typeof c.number === 'number' && Number.isFinite(c.number)
      ? Math.trunc(c.number)
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
      now,
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
}

module.exports = { seedManualCatalog, loadPackRows };
