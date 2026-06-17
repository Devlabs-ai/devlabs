'use strict';

const catalogueStore = require('../catalogueStore');
const { CATALOG } = require('./catalogue');
const { seedEntryToRow, dbCategory } = require('./catalogueEntryToRow');

/**
 * Seed catalogue from catalogue/seeds/catalogue.js.
 * Insert-only: never updates or backfills from specialists / legacy files.
 */
async function seedCatalogue({
  category = null,
  dryRun = false,
  onLog = console.log,
}: {
  category?: string | null;
  dryRun?: boolean;
  onLog?: (msg: string) => void;
} = {}): Promise<{ inserted: number; skipped: number; failed: number; entryCount: number }> {
  let entries = CATALOG;
  if (category) {
    entries = CATALOG.filter((e: Record<string, unknown>) => e.category === category || (
      category === 'global' && e.category === 'docker-images'
    ));
    if (entries.length === 0) {
      const err = new Error(`no catalogue entries match category=${category}`) as Error & { availableCategories?: string[] };
      err.availableCategories = [...new Set<string>(CATALOG.map((e: Record<string, unknown>) => e.category as string))].sort();
      throw err;
    }
  }

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const row = seedEntryToRow(entry);
    const prefix = `[catalogue-seed] (${i + 1}/${entries.length}) ${row.category}`;

    if (dryRun) {
      onLog(`${prefix}: would insert if absent`);
      inserted++;
      continue;
    }

    try {
      const saved = await catalogueStore.insertIfAbsent(row);
      if (saved) {
        onLog(`${prefix}: inserted`);
        inserted++;
      } else {
        onLog(`${prefix}: skipped (already present)`);
        skipped++;
      }
    } catch (e) {
      onLog(`${prefix}: FAILED — ${(e as Error).message}`);
      failed++;
    }
  }

  if (!dryRun) {
    await catalogueStore.loadCache();
  }

  return { inserted, skipped, failed, entryCount: entries.length };
}

/** Seed only when catalogue is completely empty. Never touches existing rows. */
async function seedCatalogueIfEmpty({
  onLog = console.log,
}: {
  onLog?: (msg: string) => void;
} = {}): Promise<number> {
  const total = await catalogueStore.count();
  if (total > 0) {
    onLog(`[catalogue-seed] catalogue has ${total} row(s) — loading cache (no backfill)`);
    await catalogueStore.loadCache();
    return 0;
  }

  onLog('[catalogue-seed] catalogue is empty — seeding from catalogue/seeds/catalogue.js...');
  const { inserted, skipped, failed } = await seedCatalogue({ onLog });
  onLog(`[catalogue-seed] done — inserted ${inserted}, skipped ${skipped}, failed ${failed}`);
  return inserted;
}

module.exports = { seedCatalogue, seedCatalogueIfEmpty, CATALOG, dbCategory };
