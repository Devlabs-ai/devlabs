'use strict';

import type { ServiceSpec, CatalogueEntry } from '../../types/domain';

const catalogueStore = require('./catalogueStore');
const { normalizeCategory, inferServiceRoles } = require('./resolveObservables');

const ROLE_TO_CATEGORY: Record<string, string> = {
  postgres: 'postgres',
  redis: 'redis',
  kafka: 'apache-kafka',
  spark: 'apache-spark',
  'load-generator': 'load-generator',
  api: 'python',
  app: 'python',
};

const DEFAULT_LIMITS = { cpus: '0.5', memory: '256M' };

function serviceFromCatalogue(name: string, entry: CatalogueEntry | null): ServiceSpec {
  if (!entry) {
    return { name, image_hint: null, limits: { ...DEFAULT_LIMITS }, notes: '' };
  }
  return {
    name,
    image_hint: entry.image || null,
    limits: entry.defaultLimits ? { ...entry.defaultLimits } : { ...DEFAULT_LIMITS },
    notes: '',
  };
}

function defaultMetricsFromCatalogue(): Record<string, unknown> {
  const loadGen: CatalogueEntry | null = catalogueStore.getCached('load-generator');
  return {
    enabled: false,
    service: 'load-generator',
    format: loadGen?.metricFormat || 'METRIC latency=<float> errors=<int> dbCpu=<float>',
    interval_seconds: 1,
    display: {
      primary: 'latency',
      secondary: ['errors'],
      guidance: 'Watch for clear broken vs healthy behavior in the metrics panel.',
    },
    recovery: {
      latency_below_ms: 100,
      consecutive_samples: 10,
    },
  };
}

/** Legacy-import defaults: conf.draftDefaults on category row, else catalogue-derived stubs. */
function loadDraftDefaults(category: string | null | undefined): {
  infra: { services: ServiceSpec[] };
  arch: string;
  data: Record<string, unknown>;
  metrics: Record<string, unknown>;
} {
  const cat = normalizeCategory(category || 'general');
  const entry: CatalogueEntry | null = catalogueStore.getCached(cat);
  const fromConf = (entry?.conf as Record<string, unknown> | null)?.draftDefaults;
  if (fromConf && typeof fromConf === 'object') {
    const dc = fromConf as Record<string, unknown>;
    return {
      infra: (dc.infra as { services: ServiceSpec[] }) || { services: [] },
      arch: (dc.arch as string) || '',
      data: (dc.data as Record<string, unknown>) || {},
      metrics: { ...defaultMetricsFromCatalogue(), ...((dc.metrics as Record<string, unknown>) || {}) },
    };
  }

  const services: ServiceSpec[] = [];
  if (entry?.image && cat !== 'global') {
    services.push(serviceFromCatalogue(cat, entry));
  }
  const loadGen: CatalogueEntry | null = catalogueStore.getCached('load-generator');
  if (loadGen && !services.some((s) => /load[-_]?gen/i.test(s.name))) {
    services.push(serviceFromCatalogue('load-generator', loadGen));
  }

  return {
    infra: { services },
    arch: '',
    data: {},
    metrics: defaultMetricsFromCatalogue(),
  };
}

function enrichServiceFromCatalogue(serviceName: string): ServiceSpec {
  const roles: string[] = inferServiceRoles({ name: serviceName }).roles;
  for (const role of roles) {
    const cat = ROLE_TO_CATEGORY[role];
    if (!cat) continue;
    const entry: CatalogueEntry | null = catalogueStore.getCached(cat);
    if (entry?.image) {
      return serviceFromCatalogue(serviceName, entry);
    }
  }
  const python: CatalogueEntry | null = catalogueStore.getCached('python');
  if (python?.image && /api|service|orders|catalog|user/i.test(serviceName)) {
    return serviceFromCatalogue(serviceName, python);
  }
  return serviceFromCatalogue(serviceName, null);
}

module.exports = {
  loadDraftDefaults,
  enrichServiceFromCatalogue,
  serviceFromCatalogue,
};
