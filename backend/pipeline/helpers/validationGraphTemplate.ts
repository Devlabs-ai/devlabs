'use strict';

/**
 * Build a canonical validationSpec template for challenge.json from the authoring draft.
 * Injected into the CODE agent payload so scaffold/repair emit executor-compatible graphs
 * (service + path, cmd arrays, graph.entry + graph.nodes — never url/setup/perturb/observe).
 */

import type { ChallengeDraft } from '../../types/domain';

const INFRA_SERVICE_NAMES = new Set([
  'postgres',
  'redis',
  'kafka',
  'zookeeper',
  'kafka-ui',
  'schema-registry',
  'load-generator',
  'cassandra',
  'mysql',
  'mongodb',
]);

function serviceNames(draft: ChallengeDraft): string[] {
  return (draft.infra?.services || [])
    .map((s: unknown) => (typeof s === 'string' ? s : (s as Record<string, string>).name))
    .filter(Boolean);
}

/** Primary HTTP API service (first non-infra service in draft.infra). */
export function inferAppService(draft: ChallengeDraft): string | null {
  const names = serviceNames(draft);
  return names.find((n) => !INFRA_SERVICE_NAMES.has(n.toLowerCase())) || names[0] || null;
}

export function inferReadyServices(draft: ChallengeDraft): string[] {
  if (Array.isArray(draft.readyServices) && draft.readyServices.length) {
    return draft.readyServices;
  }
  const vs = draft.sandboxSpec?.validationSpec as { readyServices?: string[] } | undefined;
  if (Array.isArray(vs?.readyServices) && vs.readyServices.length) {
    return vs.readyServices;
  }
  return serviceNames(draft).filter((n) => !['load-generator'].includes(n.toLowerCase()));
}

function symptomRecord(raw: unknown, index: number): { id: number; check: string } {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const id = typeof o.id === 'number' ? o.id : (typeof o.order === 'number' ? o.order : index + 1);
    const check = typeof o.check === 'string' ? o.check : '';
    return { id, check };
  }
  return { id: index + 1, check: String(raw || '') };
}

function extractHttpPath(check: string, fallback = '/health'): string {
  const m = check.match(/(?:GET|PUT|POST|PATCH|DELETE)\s+(\/[^\s,]+)/i);
  if (m) return m[1];
  const m2 = check.match(/(\/products\/\d+)/i);
  if (m2) return m2[1];
  return fallback;
}

function classifySymptom(check: string): 'http_stale' | 'postgres' | 'redis' | 'generic_http' {
  const lower = check.toLowerCase();
  if (/redis-cli|\bredis\b/.test(lower) && /get\s+\w+/i.test(check)) return 'redis';
  if (/postgres|psql|select\s+/i.test(lower)) return 'postgres';
  if (/get\s+\S+.*put\s+\S+|read-after-write|stale|cached/i.test(check)) return 'http_stale';
  return 'generic_http';
}

function httpStaleGraph(symptomId: number, appService: string, path: string): Record<string, unknown> {
  const p = `s${symptomId}_`;
  return {
    entry: `${p}warm`,
    expectBroken: true,
    nodes: {
      [`${p}warm`]: {
        type: 'http',
        service: appService,
        path,
        note: 'Warm cache via cache-aside miss',
        next: [`${p}baseline`],
      },
      [`${p}baseline`]: {
        type: 'http',
        service: appService,
        path,
        note: 'Snapshot before write',
        next: [`${p}put`],
      },
      [`${p}put`]: {
        type: 'http',
        service: appService,
        method: 'PUT',
        path,
        body: { name: 'VALIDATION_SENTINEL', price: 99.99 },
        check: { statusOk: true },
        next: [`${p}wait`],
      },
      [`${p}wait`]: { type: 'wait', ms: 150, next: [`${p}after`] },
      [`${p}after`]: {
        type: 'http',
        service: appService,
        path,
        note: 'Judge compares to baseline — expect stale unchanged body',
        next: [],
      },
    },
    coverage: { brokenStateGoals: ['HTTP read-after-write serves pre-update values'] },
  };
}

function redisGraph(symptomId: number, appService: string, path: string, check: string): Record<string, unknown> {
  const p = `s${symptomId}_`;
  const keyMatch = check.match(/GET\s+(\S+)/i);
  const redisKey = keyMatch ? keyMatch[1] : 'product:1';
  return {
    entry: `${p}warm`,
    expectBroken: true,
    nodes: {
      [`${p}warm`]: {
        type: 'http',
        service: appService,
        path,
        next: [`${p}redis_before`],
      },
      [`${p}redis_before`]: {
        type: 'exec',
        service: 'redis',
        cmd: ['redis-cli', 'GET', redisKey],
        note: 'Snapshot Redis before write',
        next: [`${p}put`],
      },
      [`${p}put`]: {
        type: 'http',
        service: appService,
        method: 'PUT',
        path,
        body: { name: 'SENTINEL_REDIS', price: 99.99 },
        check: { statusOk: true },
        next: [`${p}wait`],
      },
      [`${p}wait`]: { type: 'wait', ms: 150, next: [`${p}redis_after`] },
      [`${p}redis_after`]: {
        type: 'exec',
        service: 'redis',
        cmd: ['redis-cli', 'GET', redisKey],
        note: 'Judge compares stdout to redis_before — expect unchanged',
        next: [],
      },
    },
    coverage: { brokenStateGoals: ['Redis key retains stale payload after update'] },
  };
}

function postgresGraph(symptomId: number, appService: string, path: string): Record<string, unknown> {
  const p = `s${symptomId}_`;
  return {
    entry: `${p}put`,
    expectBroken: true,
    nodes: {
      [`${p}put`]: {
        type: 'http',
        service: appService,
        method: 'PUT',
        path,
        body: { name: 'DB_SENTINEL', price: 55.5 },
        check: { statusOk: true },
        next: [`${p}wait`],
      },
      [`${p}wait`]: { type: 'wait', ms: 150, next: [`${p}db_query`] },
      [`${p}db_query`]: {
        type: 'exec',
        service: 'postgres',
        cmd: ['psql', '-U', 'postgres', '-d', 'products_db', '-c', 'SELECT name, price FROM products WHERE id=1;'],
        note: 'Confirm Postgres row updated',
        next: [],
      },
    },
    coverage: { brokenStateGoals: ['Postgres write succeeds while cache may remain stale'] },
  };
}

function genericHttpGraph(symptomId: number, appService: string, path: string): Record<string, unknown> {
  const p = `s${symptomId}_`;
  return {
    entry: `${p}probe`,
    expectBroken: true,
    nodes: {
      [`${p}probe`]: {
        type: 'http',
        service: appService,
        path,
        note: 'Extend nodes from symptomCheck — always use service + path, never url',
        next: [],
      },
    },
    coverage: { brokenStateGoals: ['Symptom observable via HTTP'] },
  };
}

/**
 * Canonical validationSpec skeleton for challenge.json — copy structure verbatim;
 * adjust paths/bodies/cmd to match symptomCheck and init schema.
 */
export function buildValidationSpecTemplate(draft: ChallengeDraft): Record<string, unknown> {
  const symptoms = draft.brokenState?.validationSymptoms || [];
  const appService = inferAppService(draft) || 'api-service';
  const readyServices = inferReadyServices(draft);

  const graphs = symptoms.map((raw, index) => {
    const { id, check } = symptomRecord(raw, index);
    const path = extractHttpPath(check, '/health');
    const kind = classifySymptom(check);
    let graph: Record<string, unknown>;
    if (kind === 'redis') graph = redisGraph(id, appService, path, check);
    else if (kind === 'postgres') graph = postgresGraph(id, appService, path);
    else if (kind === 'http_stale') graph = httpStaleGraph(id, appService, path);
    else graph = genericHttpGraph(id, appService, path);

    return {
      symptomId: id,
      symptomCheck: check,
      graph,
    };
  });

  return {
    readyServices,
    terminalService: appService,
    graphs,
    _templateNotes: [
      'Copy this object into challenge.json as validationSpec.',
      'HTTP nodes: service (compose name) + path only — never url or ${HOST_PORT_*}.',
      'Exec nodes: cmd string array — never command.',
      'Wait nodes: ms — never timeout.',
      'Each graphs[] entry must have graph.entry and graph.nodes (not setup/perturb/observe).',
    ],
  };
}

module.exports = {
  buildValidationSpecTemplate,
  inferAppService,
  inferReadyServices,
};
