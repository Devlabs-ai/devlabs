'use strict';

import type { ChallengeDraft, CatalogueEntry } from '../../types/domain';

const catalogueStore = require('./catalogueStore');
const { collectCatalogCategories } = require('./resolveObservables');

/** Build handbook context for the build agent from cached catalogue rows. */
function buildBrief({ draft }: { draft: ChallengeDraft }): {
  category: string | null;
  matchedCategories: string[];
  entries: Array<Omit<CatalogueEntry, 'id'>>;
} {
  const categories: string[] = collectCatalogCategories(draft);
  const entries = catalogueStore.getCachedByCategories(categories).map((e: CatalogueEntry) => ({
    category: e.category,
    title: e.image || e.category,
    dos: e.dos,
    donts: e.donts,
    conf: e.conf,
    handbookText: e.handbookText,
    image: e.image,
    imageHints: e.imageHints,
    defaultLimits: e.defaultLimits,
    metricFormat: e.metricFormat,
    observables: e.observables,
  }));

  return {
    category: draft?.meta?.category || (draft as Record<string, unknown>)?.category as string || null,
    matchedCategories: categories,
    entries,
  };
}

module.exports = { buildBrief };
