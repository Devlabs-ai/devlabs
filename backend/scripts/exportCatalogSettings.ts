#!/usr/bin/env npx tsx
/**
 * Copy lab visibility + tokens from the local DB into the pack JSON files so the
 * next deploy applies them everywhere.
 *
 *   npx tsx scripts/exportCatalogSettings.ts
 */
'use strict';

require('dotenv').config({ override: true });

const pool = require('../db/pool');
const { writePackSettings } = require('../challenges/catalogSettings');

async function main(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, visible_to, tokens FROM challenges ORDER BY id`,
  );
  let written = 0;
  for (const r of rows as Array<{ id: string; visible_to: string; tokens: number }>) {
    if (writePackSettings(r.id, { visibleTo: r.visible_to, tokens: Number(r.tokens) })) {
      written += 1;
      console.log(`${r.id}: visibleTo=${r.visible_to} tokens=${r.tokens}`);
    } else {
      console.warn(`${r.id}: no pack file, skipped`);
    }
  }
  console.log(`\nwrote ${written}/${rows.length} packs`);
  await pool.end();
}

main().catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
