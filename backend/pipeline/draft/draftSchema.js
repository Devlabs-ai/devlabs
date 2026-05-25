'use strict';

/**
 * Challenge draft schema v1 + legacy normalization.
 *
 * v1 shape:
 *   meta, description, infra, arch, codebase, data, metrics, brokenState
 */

const { resolveObservables } = require('../catalogue/resolveObservables');
const { loadDraftDefaults, enrichServiceFromCatalogue } = require('../catalogue/draftFromCatalogue');

const SCHEMA_VERSION = 1;

const CATEGORIES = ['postgres', 'redis', 'kafka', 'spark', 'airflow', 'python', 'networking', 'general'];

function isV1Draft(draft) {
  return draft && (draft.schemaVersion === 1 || (draft.brokenState && draft.infra));
}

function lines(...parts) {
  return parts.filter(Boolean).join('\n\n');
}

function legacyProblemStatementToDescription(draft) {
  const ps = draft.problemStatement;
  if (!ps || typeof ps !== 'object') {
    return draft.description || '';
  }
  const tasks = Array.isArray(ps.tasks) ? ps.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n') : '';
  const db = Array.isArray(ps.dbAccess) ? ps.dbAccess.map((l) => `- ${l}`).join('\n') : '';
  return lines(
    ps.incident ? `## ${ps.incident}` : '',
    ps.severity ? `**Severity:** ${ps.severity}` : '',
    ps.situation || '',
    ps.architecture ? `### Architecture\n${ps.architecture}` : '',
    tasks ? `### Tasks\n${tasks}` : '',
    db ? `### Access\n${db}` : '',
    ps.scoring ? `### Scoring\n${ps.scoring}` : '',
  ).trim();
}

function legacyToBrokenState(sandboxSpec) {
  if (!sandboxSpec) return { rootCause: '', validationSymptoms: [] };
  const symptoms = [];
  if (sandboxSpec.brokenState) {
    symptoms.push({
      order: 1,
      check: `Broken state is present: ${sandboxSpec.brokenState}`,
    });
  }
  if (sandboxSpec.validationApproach) {
    symptoms.push({
      order: symptoms.length + 1,
      check: sandboxSpec.validationApproach,
    });
  }
  return {
    rootCause: sandboxSpec.brokenState || sandboxSpec.description || '',
    validationSymptoms: symptoms,
  };
}

function serviceNamesFromInfra(infra) {
  if (!infra?.services) return [];
  return infra.services.map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean);
}

/** Fill missing image_hint / limits from catalogue when Phase 2 merge was incomplete. */
function materializeInfraServices(infra) {
  if (!infra?.services?.length) return infra || { services: [] };
  const services = infra.services
    .map((s) => {
      const name = typeof s === 'string' ? s.trim() : String(s?.name || '').trim();
      if (!name) return null;
      const base = typeof s === 'string' ? { name } : { ...s, name };
      if (base.image_hint?.trim()) return base;
      const enriched = enrichServiceFromCatalogue(name);
      return {
        ...enriched,
        ...base,
        name,
        image_hint: enriched.image_hint || base.image_hint || null,
        limits: base.limits || enriched.limits,
        env_hints: base.env_hints ?? enriched.env_hints ?? {},
        notes: base.notes?.trim() ? base.notes : (enriched.notes || ''),
      };
    })
    .filter(Boolean);
  return { ...infra, services };
}

function applyObservableResolution(draft) {
  const resolved = resolveObservables(draft);
  draft.metrics = draft.metrics || {};
  if (draft.metrics.enabled !== false && resolved.enabled) {
    draft.metrics.enabled = true;
  }
  draft.metrics.service = draft.metrics.service || resolved.service;
  draft.metrics.format = draft.metrics.format || resolved.format;
  draft.metrics.observe = resolved.observe;
  draft.metrics.observeResolvedFrom = resolved.resolvedFrom;
  return draft;
}

/** Build sandboxSpec shim for build/validate agents during migration. */
function toSandboxSpec(draft) {
  const infra = draft.infra || {};
  const broken = draft.brokenState || {};
  const services = serviceNamesFromInfra(infra);
  const symptoms = broken.validationSymptoms || [];
  return {
    description: draft.description?.slice(0, 500) || '',
    services,
    category: draft.meta?.category || draft.category || null,
    brokenState: broken.rootCause || '',
    validationApproach: symptoms.map((s) => s.check).filter(Boolean).join('; '),
  };
}

/**
 * Normalize raw draft JSON (v1 or legacy) to v1 + sandboxSpec shim.
 */
function normalizeDraft(raw) {
  if (!raw || typeof raw !== 'object') {
    return { schemaVersion: SCHEMA_VERSION, meta: {}, description: '', infra: { services: [] }, arch: '', codebase: { artifacts: [] }, data: {}, metrics: { enabled: false, observed: null }, brokenState: { rootCause: '', validationSymptoms: [] }, sandboxSpec: toSandboxSpec({}) };
  }

  if (isV1Draft(raw)) {
    const draft = {
      schemaVersion: SCHEMA_VERSION,
      meta: raw.meta || {},
      description: raw.description || '',
      infra: raw.infra || { services: [] },
      arch: raw.arch || '',
      codebase: raw.codebase || { artifacts: [] },
      data: raw.data || {},
      metrics: {
        enabled: false,
        observed: null,
        ...(raw.metrics || {}),
      },
      brokenState: {
        rootCause: raw.brokenState?.rootCause || '',
        validationSymptoms: raw.brokenState?.validationSymptoms || [],
      },
      title: raw.meta?.name || raw.title || null,
      category: raw.meta?.category || raw.category || null,
      difficulty: raw.meta?.difficulty || raw.difficulty || null,
      tags: raw.meta?.tags || raw.tags || [],
    };
    if (!draft.metrics.format && draft.metrics.enabled) {
      draft.metrics.format = 'METRIC latency=<float> errors=<int> dbCpu=<float>';
    }
    draft.infra = materializeInfraServices(draft.infra);
    applyObservableResolution(draft);
    draft.sandboxSpec = toSandboxSpec(draft);
    return draft;
  }

  // --- legacy (sandboxSpec + problemStatement) ---
  const category = raw.category || raw.sandboxSpec?.category;
  const defaults = loadDraftDefaults(category);
  const sandboxSpec = raw.sandboxSpec || {};
  const serviceList = Array.isArray(sandboxSpec.services)
    ? sandboxSpec.services.map((name) => {
      const tmpl = defaults.infra?.services?.find((s) => s.name === name);
      return tmpl || enrichServiceFromCatalogue(name);
    })
    : [];

  const desc = legacyProblemStatementToDescription(raw) || raw.description || '';
  const draft = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: raw.meta?.id || null,
      name: raw.title || raw.meta?.name || 'Untitled',
      category: (category || 'general').toLowerCase(),
      difficulty: (raw.difficulty || 'medium').toLowerCase(),
      author: raw.meta?.author || null,
      tags: raw.tags || [],
    },
    description: desc || sandboxSpec.brokenState || raw.title || 'Imported legacy draft',
    infra: { services: serviceList.length ? serviceList : (defaults.infra?.services || []) },
    arch: raw.problemStatement?.architecture || defaults.arch || '',
    codebase: raw.codebase || { artifacts: [] },
    data: raw.data || defaults.data || {},
    metrics: {
      ...defaults.metrics,
      observed: null,
      ...(raw.metrics || {}),
    },
    brokenState: legacyToBrokenState(sandboxSpec),
    title: raw.title,
    category: raw.category,
    difficulty: raw.difficulty,
    tags: raw.tags,
    problemStatement: raw.problemStatement,
  };

  if (serviceList.some((s) => s.name === 'load-generator')) {
    draft.metrics.enabled = true;
  }

  applyObservableResolution(draft);
  draft.sandboxSpec = toSandboxSpec(draft);
  return draft;
}

function isDraftReady(draft) {
  const d = normalizeDraft(draft);
  if (!d.description?.trim()) return false;
  if (!d.brokenState?.rootCause?.trim()) return false;
  const services = d.infra?.services || [];
  if (!services.length) return false;
  // Phase 1 contract lists service names only; build requires Phase 2 catalogue materialization.
  return services.every((s) => {
    const svc = typeof s === 'string' ? { name: s } : s;
    return !!svc.image_hint?.trim();
  });
}

const V1_SCHEMA_PROMPT = `DRAFT JSON SCHEMA (schemaVersion: 1):

{
  "schemaVersion": 1,
  "meta": {
    "id": "INC-#### (optional)",
    "name": "short title",
    "category": "postgres | redis | kafka | spark | airflow | python | networking | general",
    "difficulty": "easy | medium | hard",
    "author": "email (optional)",
    "tags": ["..."]
  },
  "description": "FULL candidate-facing problem statement (markdown OK). Qualitative only — no fake latency/RPS/SLA numbers.",
  "infra": {
    "services": [
      {
        "name": "service-name",
        "image_hint": "docker image tag hint",
        "limits": { "cpus": "0.5", "memory": "256M" },
        "env_hints": {},
        "notes": "why these limits"
      }
    ]
  },
  "arch": "high-level architecture for the candidate (how services connect)",
  "codebase": {
    "artifacts": [
      { "path": "init/init.sql", "description": "what this file is for" }
    ]
  },
  "data": {
    "tables": [],
    "distribution": {}
  },
  "metrics": {
    "enabled": true,
    "service": "load-generator",
    "format": "METRIC latency=<float> errors=<int> dbCpu=<float>",
    "interval_seconds": 1,
    "display": {
      "primary": "latency",
      "secondary": ["errors"],
      "guidance": "what to watch in the METRIC panel (qualitative)"
    },
    "recovery": {
      "latency_below_ms": 100,
      "consecutive_samples": 10
    },
    "observed": null
  },
  "brokenState": {
    "rootCause": "setter-only: exact technical cause",
    "validationSymptoms": [
      { "order": 1, "check": "qualitative symptom the built sandbox must exhibit" }
    ]
  }
}

RULES:
- Do NOT emit metrics.observed or metrics.observe (catalogue + pipeline resolve observe).
- description must NOT include precise SLA numbers (no p99=500ms, no 800 RPS).
- Put sizing knobs in data.distribution and infra.limits, not in description.
- Custom app services: Python (Flask) unless category requires JVM (spark).
- Emit inside <challenge_draft>...</challenge_draft> as strict JSON.`;

module.exports = {
  SCHEMA_VERSION,
  CATEGORIES,
  normalizeDraft,
  isDraftReady,
  isV1Draft,
  toSandboxSpec,
  V1_SCHEMA_PROMPT,
};
