'use strict';

const catalogueStore = require('./catalogueStore');
const { collectCatalogCategories } = require('./resolveObservables');

/** Build handbook context for the build agent from cached catalogue rows. */
function buildBrief({ draft }) {
  const categories = collectCatalogCategories(draft);
  const entries = catalogueStore.getCachedByCategories(categories).map((e) => ({
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
    category: draft?.meta?.category || draft?.category || null,
    matchedCategories: categories,
    entries,
  };
}

module.exports = { buildBrief };
