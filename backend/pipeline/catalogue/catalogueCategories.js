'use strict';

const catalogueStore = require('./catalogueStore');

const CATEGORY_ALIASES = {
  general: 'global',
  'docker-images': 'global',
  kafka: 'apache-kafka',
  spark: 'apache-spark',
  airflow: 'apache-airflow',
};

function normalizeCategory(category) {
  const key = String(category || 'general').toLowerCase();
  return CATEGORY_ALIASES[key] || key;
}

/** Always include global handbook row when querying catalogue. */
function sanitizeCatalogueCategories(categories) {
  const out = new Set(['global']);
  for (const raw of categories || []) {
    const key = normalizeCategory(String(raw || '').trim());
    if (!key) continue;
    if (catalogueStore.getCached(key)) out.add(key);
  }
  return [...out];
}

function parseCatalogueCategoriesTag(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c) => String(c || '').trim()).filter(Boolean);
  } catch (e) {
    console.warn('[catalogueCategories] parse failed:', e.message);
    return [];
  }
}

function getExplicitCatalogueCategories(draft) {
  const fromMeta = draft?.meta?.catalogueCategories;
  if (Array.isArray(fromMeta) && fromMeta.length) {
    return sanitizeCatalogueCategories(fromMeta);
  }
  return null;
}

function listAvailableCategoryKeys() {
  return [...catalogueStore.listCachedCategoryKeys()].sort();
}

function primaryCategoryFromList(categories) {
  const sansGlobal = (categories || []).filter((c) => c !== 'global');
  return sansGlobal[0] || 'general';
}

module.exports = {
  normalizeCategory,
  sanitizeCatalogueCategories,
  parseCatalogueCategoriesTag,
  getExplicitCatalogueCategories,
  listAvailableCategoryKeys,
  primaryCategoryFromList,
};
