'use strict';

import type { ChallengeDraft } from '../../types/domain';

const catalogueStore = require('./catalogueStore');

const CATEGORY_ALIASES: Record<string, string> = {
  general: 'global',
  'docker-images': 'global',
  kafka: 'apache-kafka',
  spark: 'apache-spark',
  airflow: 'apache-airflow',
  yarn: 'hadoop-yarn',
  hadoop: 'hadoop-yarn',
};

function normalizeCategory(category: string | null | undefined): string {
  const key = String(category || 'general').toLowerCase();
  return CATEGORY_ALIASES[key] || key;
}

/** Always include global handbook row when querying catalogue. */
function sanitizeCatalogueCategories(categories: string[]): string[] {
  const out = new Set(['global']);
  for (const raw of categories || []) {
    const key = normalizeCategory(String(raw || '').trim());
    if (!key) continue;
    if (catalogueStore.getCached(key)) out.add(key);
  }
  return [...out];
}

function parseCatalogueCategoriesTag(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c: unknown) => String(c || '').trim()).filter(Boolean);
  } catch (e) {
    console.warn('[catalogueCategories] parse failed:', (e as Error).message);
    return [];
  }
}

function getExplicitCatalogueCategories(draft: ChallengeDraft): string[] | null {
  const fromMeta = draft?.meta?.catalogueCategories;
  if (Array.isArray(fromMeta) && fromMeta.length) {
    return sanitizeCatalogueCategories(fromMeta);
  }
  return null;
}

function listAvailableCategoryKeys(): string[] {
  return [...catalogueStore.listCachedCategoryKeys()].sort();
}

function primaryCategoryFromList(categories: string[]): string {
  const sansGlobal = (categories || []).filter((c: string) => c !== 'global');
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
