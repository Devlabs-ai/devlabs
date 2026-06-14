'use strict';

import type { ChallengeDraft, CatalogueEntry, ObservableSpec } from '../../types/domain';

const catalogueStore = require('./catalogueStore');
const { getExplicitCatalogueCategories, normalizeCategory } = require('./catalogueCategories');

const ROLE_TO_CATEGORY: Record<string, string> = {
  postgres: 'postgres',
  redis: 'redis',
  kafka: 'apache-kafka',
  spark: 'apache-spark',
  'load-generator': 'load-generator',
};

interface ServiceLike {
  name?: string;
  image_hint?: string | null;
  [key: string]: unknown;
}

interface ProfiledService {
  name: string;
  roles: string[];
}

interface ResolveContext {
  roles: Set<string>;
  serviceNames: Set<string>;
  profiled: ProfiledService[];
}

/** Infer service roles from name + image_hint for catalog matching. */
function inferServiceRoles(service: ServiceLike): ProfiledService {
  const name = (service.name || '').toLowerCase();
  const hint = (service.image_hint || '').toLowerCase();
  const roles = new Set<string>();

  if (/load[-_]?gen/.test(name)) roles.add('load-generator');
  if (/postgres|mysql|mariadb/.test(name) || /postgres|mysql/.test(hint)) roles.add('postgres');
  if (/redis/.test(name) || /redis/.test(hint)) roles.add('redis');
  if (/kafka/.test(name) || /kafka/.test(hint)) roles.add('kafka');
  if (/spark/.test(name) || /spark/.test(hint)) roles.add('spark');
  if (/nginx|proxy/.test(name)) roles.add('proxy');
  if (/orders|catalog|user|api|service/.test(name) && !roles.has('load-generator')) {
    roles.add('api');
  }
  if (roles.size === 0) roles.add('app');
  return { name: service.name || '', roles: [...roles] };
}

function mergeObservables(...groups: Array<ObservableSpec[] | undefined>): ObservableSpec[] {
  const byId = new Map<string, ObservableSpec>();
  for (const group of groups) {
    for (const o of group || []) {
      if (!o?.id) continue;
      byId.set(o.id, { ...(byId.get(o.id) || {}), ...o });
    }
  }
  return [...byId.values()];
}

function catalogMatches(obs: ObservableSpec, ctx: ResolveContext): boolean {
  const req = obs.requires || {};
  if (req.roles?.length) {
    const ok = req.roles.every((r: string) => ctx.roles.has(r));
    if (!ok) return false;
  }
  if (req.infra?.length) {
    const ok = req.infra.every((name: string) => ctx.serviceNames.has(name));
    if (!ok) return false;
  }
  if (req.serviceNames?.length) {
    const ok = req.serviceNames.some((n: string) => ctx.serviceNames.has(n));
    if (!ok) return false;
  }
  if (req.anyRole?.length) {
    const ok = req.anyRole.some((r: string) => ctx.roles.has(r));
    if (!ok) return false;
  }
  return true;
}

function collectCatalogCategories(draft: ChallengeDraft): string[] {
  const explicit = getExplicitCatalogueCategories(draft);
  if (explicit) return explicit;

  const categories = new Set<string>(['global']);

  const metaCat = normalizeCategory(draft.meta?.category || (draft as Record<string, unknown>).category as string);
  if (metaCat) categories.add(metaCat);

  const services = (draft.infra?.services || []).map((s) => (
    typeof s === 'string' ? { name: s } : s
  ));
  for (const service of services) {
    const { roles } = inferServiceRoles(service as ServiceLike);
    for (const role of roles) {
      const cat = ROLE_TO_CATEGORY[role];
      if (cat) categories.add(cat);
    }
  }

  return [...categories];
}

function getEntriesForCategories(categories: string[]): CatalogueEntry[] {
  return catalogueStore.getCachedByCategories(categories);
}

/**
 * Pick observables from unified catalogue rows (category + infra participation).
 * Draft may override via metrics.observe (by id).
 */
function resolveObservables(draft: ChallengeDraft): {
  enabled: boolean;
  service: string;
  format: string;
  observe: ObservableSpec[];
  resolvedFrom: {
    category: string;
    categories: string[];
    roles: string[];
    serviceNames: string[];
    catalogCount: number;
    explicitCount: number;
  };
} {
  const draftCategory = draft.meta?.category || (draft as Record<string, unknown>).category as string || 'general';
  const metaCategory = normalizeCategory(draftCategory);
  const categories = collectCatalogCategories(draft);
  const entries: CatalogueEntry[] = getEntriesForCategories(categories);

  const services = (draft.infra?.services || []).map((s) => (
    typeof s === 'string' ? { name: s } : s
  ));
  const profiled = services.map((s) => inferServiceRoles(s as ServiceLike));
  const roles = new Set<string>(profiled.flatMap((p) => p.roles));
  const serviceNames = new Set<string>(profiled.map((p) => p.name));

  const ctx: ResolveContext = { roles, serviceNames, profiled };

  const merged = mergeObservables(...entries.map((e) => e.observables));
  const fromCatalog = merged.filter((o) => catalogMatches(o, ctx));

  const explicit = Array.isArray(draft.metrics?.observe) ? draft.metrics!.observe! : [];
  const byId = new Map<string, ObservableSpec>(fromCatalog.map((o) => [o.id, { ...o }]));
  for (const o of explicit) {
    if (o?.id) byId.set(o.id, { ...(byId.get(o.id) || {}), ...o });
  }

  const observe = [...byId.values()];
  const enabled = draft.metrics?.enabled !== false
    && observe.length > 0
    && roles.has('load-generator');

  const metaEntry = entries.find((e) => e.category === metaCategory);
  const loadGenEntry = entries.find((e) => e.category === 'load-generator');

  const metricsService = draft.metrics?.service
    || loadGenEntry?.category
    || 'load-generator';

  const format = draft.metrics?.format
    || metaEntry?.metricFormat
    || loadGenEntry?.metricFormat
    || 'METRIC latency=<float> errors=<int> dbCpu=<float>';

  return {
    enabled,
    service: metricsService,
    format,
    observe,
    resolvedFrom: {
      category: draftCategory,
      categories,
      roles: [...roles],
      serviceNames: [...serviceNames],
      catalogCount: fromCatalog.length,
      explicitCount: explicit.length,
    },
  };
}

module.exports = {
  inferServiceRoles,
  resolveObservables,
  collectCatalogCategories,
  normalizeCategory,
};
