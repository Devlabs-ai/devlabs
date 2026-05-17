#!/usr/bin/env node

'use strict';

// CLI wrapper for catalog seeding. See backend/problems/seeds/runCatalogSeed.js.

require('dotenv').config();

const pool = require('../db/pool');
const memoryStore = require('../problems/memoryStore');
const llm = require('../llm/client');
const { seedCatalog, CATALOG } = require('../problems/seeds/runCatalogSeed');

function parseArgs(argv) {
  const out = { force: false, dryRun: false, category: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--force') out.force = true;
    else if (arg === '--dry-run' || arg === '--dryrun') out.dryRun = true;
    else if (arg.startsWith('--category=')) out.category = arg.slice('--category='.length);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else console.warn(`[seed] ignoring unknown flag: ${arg}`);
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/seedMemory.js [options]

Options:
  --force               Delete existing rows in the catalog's categories before seeding.
  --category=<slug>     Seed only entries whose category matches this slug.
  --dry-run             Print planned actions without DB writes or embedding API calls.
  -h, --help            Show this help.
`);
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) { printHelp(); return; }

  if (!llm.isEmbeddingConfigured() && !opts.dryRun) {
    console.error('[seed] OPENAI_API_KEY is not set.');
    process.exitCode = 1;
    return;
  }

  if (opts.category) {
    const match = CATALOG.filter((e) => e.category === opts.category);
    if (match.length === 0) {
      console.error(`[seed] no catalog entries match --category=${opts.category}`);
      console.error(`[seed] available: ${[...new Set(CATALOG.map((e) => e.category))].sort().join(', ')}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`[seed] mode: ${opts.dryRun ? 'DRY-RUN' : opts.force ? 'FORCE' : 'IDEMPOTENT'}`);
  console.log(`[seed] embedding model: ${llm.getEmbeddingModel()}`);
  console.log('');

  const t0 = Date.now();
  try {
    const { inserted, skipped, failed } = await seedCatalog({
      force: opts.force,
      category: opts.category,
      dryRun: opts.dryRun,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('');
    console.log(`[seed] done in ${elapsed}s — inserted ${inserted}, skipped ${skipped}, failed ${failed}`);
    if (!opts.dryRun) {
      console.log(`[seed] build_memory now holds ${await memoryStore.count()} row(s)`);
    }
    if (failed > 0) process.exitCode = 1;
  } catch (e) {
    console.error('[seed] fatal:', e.message);
    if (e.availableCategories) {
      console.error(`[seed] available categories: ${e.availableCategories.join(', ')}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error('[seed] fatal:', e); process.exitCode = 1; })
  .finally(async () => { try { await pool.end(); } catch (_e) { /* noop */ } });
