'use strict';

const catalogueStore = require('./catalogueStore');
const { normalizeCategory, inferServiceRoles } = require('./resolveObservables');

const ROLE_TO_CATEGORY = {
  postgres: 'postgres',
  redis: 'redis',
  kafka: 'apache-kafka',
  spark: 'apache-spark',
  'load-generator': 'load-generator',
  api: 'python',
  app: 'python',
};

const DEFAULT_LIMITS = { cpus: '0.5', memory: '256M' };

function serviceFromCatalogue(name, entry) {
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

function defaultMetricsFromCatalogue() {
  const loadGen = catalogueStore.getCached('load-generator');
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
function loadDraftDefaults(category) {
  const cat = normalizeCategory(category || 'general');
  const entry = catalogueStore.getCached(cat);
  const fromConf = entry?.conf?.draftDefaults;
  if (fromConf && typeof fromConf === 'object') {
    return {
      infra: fromConf.infra || { services: [] },
      arch: fromConf.arch || '',
      data: fromConf.data || {},
      metrics: { ...defaultMetricsFromCatalogue(), ...(fromConf.metrics || {}) },
    };
  }

  const services = [];
  if (entry?.image && cat !== 'global') {
    services.push(serviceFromCatalogue(cat, entry));
  }
  const loadGen = catalogueStore.getCached('load-generator');
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

function enrichServiceFromCatalogue(serviceName) {
  const roles = inferServiceRoles({ name: serviceName }).roles;
  for (const role of roles) {
    const cat = ROLE_TO_CATEGORY[role];
    if (!cat) continue;
    const entry = catalogueStore.getCached(cat);
    if (entry?.image) {
      return serviceFromCatalogue(serviceName, entry);
    }
  }
  const python = catalogueStore.getCached('python');
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
