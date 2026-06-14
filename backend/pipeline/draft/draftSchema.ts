'use strict';

/**
 * Challenge draft schema v1 + legacy normalization.
 *
 * v1 shape:
 *   meta, description, infra, arch, codebase, data, metrics, brokenState
 */

import type { ChallengeDraft, ServiceSpec, DraftMeta } from '../../types/domain';

const { resolveObservables } = require('../catalogue/resolveObservables');
const { loadDraftDefaults, enrichServiceFromCatalogue } = require('../catalogue/draftFromCatalogue');

const SCHEMA_VERSION = 1;

const CATEGORIES = ['postgres', 'redis', 'kafka', 'spark', 'airflow', 'python', 'networking', 'general'];

function isV1Draft(draft: unknown): boolean {
  if (!draft || typeof draft !== 'object') return false;
  const d = draft as ChallengeDraft;
  return !!(d.schemaVersion === 1 || (d.brokenState && d.infra));
}

function lines(...parts: (string | undefined | null)[]): string {
  return parts.filter(Boolean).join('\n\n');
}

function legacyProblemStatementToDescription(draft: Record<string, unknown>): string {
  const ps = draft.problemStatement as Record<string, unknown> | null | undefined;
  if (!ps || typeof ps !== 'object') {
    return (draft.description as string) || '';
  }
  const tasks = Array.isArray(ps.tasks) ? (ps.tasks as string[]).map((t, i) => `${i + 1}. ${t}`).join('\n') : '';
  const db = Array.isArray(ps.dbAccess) ? (ps.dbAccess as string[]).map((l) => `- ${l}`).join('\n') : '';
  return lines(
    ps.incident ? `## ${ps.incident as string}` : '',
    ps.severity ? `**Severity:** ${ps.severity as string}` : '',
    (ps.situation as string) || '',
    ps.architecture ? `### Architecture\n${ps.architecture as string}` : '',
    tasks ? `### Tasks\n${tasks}` : '',
    db ? `### Access\n${db}` : '',
    ps.scoring ? `### Scoring\n${ps.scoring as string}` : '',
  ).trim();
}

function legacyToBrokenState(sandboxSpec: Record<string, unknown> | null | undefined): {
  rootCause: string;
  validationSymptoms: Array<{ order: number; check: string }>;
} {
  if (!sandboxSpec) return { rootCause: '', validationSymptoms: [] };
  const symptoms: Array<{ order: number; check: string }> = [];
  if (sandboxSpec.brokenState) {
    symptoms.push({
      order: 1,
      check: `Broken state is present: ${sandboxSpec.brokenState as string}`,
    });
  }
  if (sandboxSpec.validationApproach) {
    symptoms.push({
      order: symptoms.length + 1,
      check: sandboxSpec.validationApproach as string,
    });
  }
  return {
    rootCause: (sandboxSpec.brokenState as string) || (sandboxSpec.description as string) || '',
    validationSymptoms: symptoms,
  };
}

function serviceNamesFromInfra(infra: ChallengeDraft['infra']): string[] {
  if (!infra?.services) return [];
  return infra.services.map((s) => (typeof s === 'string' ? s : (s as ServiceSpec).name)).filter(Boolean) as string[];
}

/** Fill missing image_hint / limits from catalogue when Phase 2 merge was incomplete. */
function materializeInfraServices(infra: ChallengeDraft['infra']): ChallengeDraft['infra'] {
  if (!infra?.services?.length) return infra || { services: [] };
  const services = infra.services
    .map((s) => {
      const name = typeof s === 'string' ? (s as string).trim() : String((s as ServiceSpec)?.name || '').trim();
      if (!name) return null;
      const base: ServiceSpec = typeof s === 'string' ? { name } : { ...(s as ServiceSpec), name };
      if (base.image_hint?.trim()) return base;
      const enriched: ServiceSpec = enrichServiceFromCatalogue(name);
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
    .filter((s): s is ServiceSpec => s !== null);
  return { ...infra, services };
}

function applyObservableResolution(draft: ChallengeDraft): void {
  const resolved = resolveObservables(draft);
  draft.metrics = draft.metrics || {};
  if (draft.metrics.enabled !== false && resolved.enabled) {
    draft.metrics.enabled = true;
  }
  draft.metrics.service = draft.metrics.service || resolved.service;
  draft.metrics.format = draft.metrics.format || resolved.format;
  (draft.metrics as Record<string, unknown>).observe = resolved.observe;
  (draft.metrics as Record<string, unknown>).observeResolvedFrom = resolved.resolvedFrom;
}

/** Build sandboxSpec shim for build/validate agents during migration. */
function toSandboxSpec(draft: ChallengeDraft): Record<string, unknown> {
  const infra = draft.infra || { services: [] };
  const broken = draft.brokenState || { rootCause: '', validationSymptoms: [] };
  const services = serviceNamesFromInfra(infra);
  const symptoms = broken.validationSymptoms || [];
  return {
    description: draft.description?.slice(0, 500) || '',
    services,
    category: draft.meta?.category || (draft as Record<string, unknown>).category || null,
    brokenState: broken.rootCause || '',
    validationApproach: symptoms.map((s) => (s as Record<string, unknown>).check).filter(Boolean).join('; '),
  };
}

/**
 * Normalize raw draft JSON (v1 or legacy) to v1 + sandboxSpec shim.
 */
function normalizeDraft(raw: unknown): ChallengeDraft {
  if (!raw || typeof raw !== 'object') {
    const empty: ChallengeDraft = { schemaVersion: SCHEMA_VERSION, meta: {}, description: '', infra: { services: [] }, arch: '', codebase: { artifacts: [] }, data: {}, metrics: { enabled: false }, brokenState: { rootCause: '', validationSymptoms: [] } };
    empty.sandboxSpec = toSandboxSpec(empty);
    return empty;
  }

  const rawObj = raw as ChallengeDraft & Record<string, unknown>;

  if (isV1Draft(raw)) {
    const draft: ChallengeDraft & Record<string, unknown> = {
      schemaVersion: SCHEMA_VERSION,
      meta: rawObj.meta || {},
      description: rawObj.description || '',
      infra: rawObj.infra || { services: [] },
      arch: rawObj.arch || '',
      codebase: rawObj.codebase || { artifacts: [] },
      data: rawObj.data || {},
      metrics: {
        enabled: false,
        ...(rawObj.metrics || {}),
      },
      brokenState: {
        rootCause: rawObj.brokenState?.rootCause || '',
        validationSymptoms: rawObj.brokenState?.validationSymptoms || [],
      },
      title: rawObj.meta?.name || rawObj.title || null,
      category: rawObj.meta?.category || rawObj.category || null,
      difficulty: rawObj.meta?.difficulty || rawObj.difficulty || null,
      tags: (rawObj.meta as DraftMeta)?.tags || rawObj.tags || [],
    };
    if (!draft.metrics!.format && draft.metrics!.enabled) {
      draft.metrics!.format = 'METRIC latency=<float> errors=<int> dbCpu=<float>';
    }
    draft.infra = materializeInfraServices(draft.infra);
    applyObservableResolution(draft);
    draft.sandboxSpec = toSandboxSpec(draft);
    return draft;
  }

  // --- legacy (sandboxSpec + problemStatement) ---
  const category = rawObj.category || (rawObj.sandboxSpec as Record<string, unknown>)?.category;
  const defaults = loadDraftDefaults(category);
  const sandboxSpec = (rawObj.sandboxSpec as Record<string, unknown>) || {};
  const serviceList: ServiceSpec[] = Array.isArray(sandboxSpec.services)
    ? (sandboxSpec.services as string[]).map((name) => {
      const tmpl = defaults.infra?.services?.find((s: ServiceSpec) => s.name === name);
      return tmpl || enrichServiceFromCatalogue(name);
    })
    : [];

  const desc = legacyProblemStatementToDescription(rawObj) || rawObj.description || '';
  const draft: ChallengeDraft & Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: rawObj.meta?.id || null,
      name: (rawObj.title as string) || rawObj.meta?.name || 'Untitled',
      category: (String(category || 'general')).toLowerCase(),
      difficulty: (String(rawObj.difficulty || 'medium')).toLowerCase(),
      author: rawObj.meta?.author || null,
      tags: (rawObj.tags as string[]) || [],
    },
    description: (desc as string) || (sandboxSpec.brokenState as string) || (rawObj.title as string) || 'Imported legacy draft',
    infra: { services: serviceList.length ? serviceList : (defaults.infra?.services || []) },
    arch: (rawObj.problemStatement as Record<string, unknown>)?.architecture as string || defaults.arch || '',
    codebase: rawObj.codebase || { artifacts: [] },
    data: rawObj.data || defaults.data || {},
    metrics: {
      ...defaults.metrics,
      ...(rawObj.metrics || {}),
    },
    brokenState: legacyToBrokenState(sandboxSpec),
    title: rawObj.title,
    category: rawObj.category,
    difficulty: rawObj.difficulty,
    tags: rawObj.tags,
    problemStatement: rawObj.problemStatement,
  };

  if (serviceList.some((s: ServiceSpec) => s.name === 'load-generator')) {
    draft.metrics!.enabled = true;
  }

  applyObservableResolution(draft);
  draft.sandboxSpec = toSandboxSpec(draft);
  return draft;
}

function isDraftReady(draft: unknown): boolean {
  const d = normalizeDraft(draft);
  if (!d.description?.trim()) return false;
  if (!d.brokenState?.rootCause?.trim()) return false;
  const services = d.infra?.services || [];
  if (!services.length) return false;
  // Phase 1 contract lists service names only; build requires Phase 2 catalogue materialization.
  return services.every((s) => {
    const svc = typeof s === 'string' ? { name: s } : s as ServiceSpec;
    return !!(svc as ServiceSpec).image_hint?.trim();
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
      { "id": 1, "check": "Concrete probe + wrong result that proves the bug: action a candidate takes and the surprising output they see." },
      { "id": 2, "check": "Another reproducible probe that further confirms the broken state. Do NOT describe the fixed/healthy state." }
    ]
  }
}

RULES:
- Do NOT emit metrics.observed or metrics.observe (catalogue + pipeline resolve observe).
- description must NOT include precise SLA numbers (no p99=500ms, no 800 RPS).
- Put sizing knobs in data.distribution and infra.limits, not in description.
- Custom app services: Python (Flask) unless category requires JVM (spark).
- description must NOT mention the load generator, traffic generator, simulated traffic,
  load simulation, or any internal tooling. The candidate should not know that synthetic
  traffic is being generated. Write only from the perspective of real user-reported symptoms.
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
