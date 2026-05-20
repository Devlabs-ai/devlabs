'use strict';

// Seed specialists table from imageCatalog. Used by:
//   - backend/scripts/seedMemory.js (CLI / make seed-memory)
//   - backend/server.js (auto-seed on boot when table is empty)

const specialistStore = require('../specialistStore');
const { CATALOG } = require('./imageCatalog');
const { catalogEntryToSpecialist } = require('./catalogToSpecialist');

/**
 * Seed catalog entries into specialists.
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

  if (force && !dryRun) {
    const categories = [...new Set(entries.map((e) => e.category))];
    for (const cat of categories) {
      const removed = await specialistStore.removeByCategory(cat);
      onLog(`[seed] --force removed ${removed} specialist row(s) for "${cat}"`);
    }
  }

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const spec = catalogEntryToSpecialist(entry);
    const sig = specialistStore.sigOf(spec.category, spec.stack, spec.title);
    const tag = spec.title;
    const prefix = `[seed] (${i + 1}/${entries.length}) ${spec.category} / ${tag}`;

    if (dryRun) {
      onLog(`${prefix}: would upsert`);
      inserted++;
      continue;
    }

    if (!force && await specialistStore.existsBySignature(sig)) {
      onLog(`${prefix}: skipped (already present)`);
      skipped++;
      continue;
    }

    try {
      const id = await specialistStore.upsert(spec);
      if (id) {
        onLog(`${prefix}: upserted (id=${id})`);
        inserted++;
      } else {
        onLog(`${prefix}: upsert returned null`);
        failed++;
      }
    } catch (e) {
      onLog(`${prefix}: FAILED — ${e.message}`);
      failed++;
    }
  }

  return { inserted, skipped, failed, entryCount: entries.length };
}

/** If specialists is empty, run a full catalog seed. Returns rows inserted (0 if skipped). */
async function seedCatalogIfEmpty({ onLog = console.log } = {}) {
  const total = await specialistStore.count();
  if (total > 0) {
    onLog(`[seed] specialists has ${total} row(s) — skipping auto-seed`);
    return 0;
  }

  onLog('[seed] specialists is empty — auto-seeding from image catalog...');
  const { inserted, skipped, failed } = await seedCatalog({ onLog });
  onLog(`[seed] auto-seed done — inserted ${inserted}, skipped ${skipped}, failed ${failed}`);
  return inserted;
}

module.exports = { seedCatalog, seedCatalogIfEmpty, CATALOG };
