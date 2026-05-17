'use strict';

// Shared catalog seeding for build_memory. Used by:
//   - backend/scripts/seedMemory.js (CLI / make seed-memory)
//   - backend/server.js (auto-seed on boot when table is empty)

const memoryStore = require('../memoryStore');
const llm = require('../../llm/client');
const { CATALOG } = require('./imageCatalog');

/**
 * Seed catalog entries into build_memory.
 * @returns {{ inserted, skipped, failed }}
 */
async function seedCatalog({
  force = false,
  category = null,
  dryRun = false,
  onLog = console.log,
} = {}) {
  let entries = CATALOG;
  if (category) {
    entries = CATALOG.filter((e) => e.category === category);
    if (entries.length === 0) {
      const err = new Error(`no catalog entries match category=${category}`);
      err.availableCategories = [...new Set(CATALOG.map((e) => e.category))].sort();
      throw err;
    }
  }

  if (!llm.isEmbeddingConfigured() && !dryRun) {
    const err = new Error('OPENAI_API_KEY is not set — cannot embed catalog entries');
    err.code = 'EMBEDDING_NOT_CONFIGURED';
    throw err;
  }

  if (force && !dryRun) {
    const categories = [...new Set(entries.map((e) => e.category))];
    for (const cat of categories) {
      const removed = await memoryStore.removeByCategory(cat);
      onLog(`[seed] --force removed ${removed} row(s) from category "${cat}"`);
    }
  }

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const tag = entry.details?.image || entry.details?.policy || entry.category;
    const sig = memoryStore.sigOf(entry.text);
    const prefix = `[seed] (${i + 1}/${entries.length}) ${entry.category} / ${tag}`;

    if (dryRun) {
      onLog(`${prefix}: would record`);
      inserted++;
      continue;
    }

    if (!force && await memoryStore.existsBySignature(sig)) {
      onLog(`${prefix}: skipped (already present)`);
      skipped++;
      continue;
    }

    try {
      const id = await memoryStore.record({
        text: entry.text,
        details: entry.details || null,
        category: entry.category || null,
      });
      if (id) {
        onLog(`${prefix}: inserted (id=${id})`);
        inserted++;
      } else {
        onLog(`${prefix}: record() returned null`);
        failed++;
      }
    } catch (e) {
      onLog(`${prefix}: FAILED — ${e.message}`);
      failed++;
    }
  }

  return { inserted, skipped, failed, entryCount: entries.length };
}

/** If build_memory is empty, run a full catalog seed. Returns rows inserted (0 if skipped). */
async function seedCatalogIfEmpty({ onLog = console.log } = {}) {
  const total = await memoryStore.count();
  if (total > 0) {
    onLog(`[seed] build_memory has ${total} row(s) — skipping auto-seed`);
    return 0;
  }

  if (!llm.isEmbeddingConfigured()) {
    onLog('[seed] OPENAI_API_KEY not set — skipping build_memory auto-seed (run make seed-memory later)');
    return 0;
  }

  onLog('[seed] build_memory is empty — auto-seeding from image catalog...');
  const { inserted, skipped, failed } = await seedCatalog({ onLog });
  onLog(`[seed] auto-seed done — inserted ${inserted}, skipped ${skipped}, failed ${failed}`);
  return inserted;
}

module.exports = { seedCatalog, seedCatalogIfEmpty, CATALOG };
