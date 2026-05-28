'use strict';

const {
  parseCatalogueCategoriesTag,
  sanitizeCatalogueCategories,
} = require('../catalogue/catalogueCategories');

const SHAPE_CONTRACT_HINT = `shape_contract JSON (schemaVersion implied 1, Phase 1 design contract only):
{
  "meta": {
    "name": "short title",
    "category": "primary stack category (one catalogue key)",
    "difficulty": "easy | medium | hard",
    "tags": ["optional"],
    "catalogueCategories": ["postgres", "python", "load-generator"]
  },
  "description": "FULL candidate-facing problem statement (markdown OK, qualitative only)",
  "arch": "how named services connect — qualitative, no Docker tags",
  "infra": {
    "services": [{ "name": "orders-service" }, { "name": "postgres" }, { "name": "load-generator" }]
  },
  "brokenState": {
    "rootCause": "exact technical root cause (setter-only)",
    "validationSymptoms": [
      { "order": 1, "check": "broken: qualitative symptom candidate or metrics should show" },
      { "order": 2, "check": "fixed: qualitative symptom after correct fix" }
    ]
  },
  "metricsIntent": {
    "enabled": true,
    "guidance": "what the candidate should watch in the metrics panel (qualitative)"
  }
}`;

function extractTag(text, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let last = null;
  let m;
  while ((m = re.exec(text)) !== null) last = m[1];
  return last ? last.trim() : null;
}

function normalizeServiceList(services) {
  if (!Array.isArray(services)) return [];
  return services
    .map((s) => {
      if (typeof s === 'string') return { name: s.trim() };
      if (s && typeof s === 'object' && s.name) return { name: String(s.name).trim() };
      return null;
    })
    .filter((s) => s?.name);
}

/** Phase 1 keeps service names only — strip catalogue implementation fields. */
function stripInfraImplementation(infra) {
  if (!infra?.services?.length) return { services: [] };
  return { services: normalizeServiceList(infra.services) };
}

function normalizeValidationSymptoms(symptoms) {
  if (!Array.isArray(symptoms)) return [];
  return symptoms
    .map((s, i) => {
      if (typeof s === 'string' && s.trim()) {
        return { order: i + 1, check: s.trim() };
      }
      if (s && typeof s === 'object' && s.check) {
        return { order: s.order || i + 1, check: String(s.check).trim() };
      }
      return null;
    })
    .filter(Boolean);
}

function parseShapeContractTag(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[shapeContract] JSON parse failed:', e.message);
    return null;
  }
}

function normalizeExtracted(extracted) {
  if (!extracted?.description?.trim()) return null;

  const meta = { ...(extracted.meta || {}) };
  const categories = extracted.catalogueCategories?.length
    ? extracted.catalogueCategories
    : sanitizeCatalogueCategories(meta.catalogueCategories || []);
  if (categories.length) meta.catalogueCategories = categories;
  if (!meta.category && categories.length) {
    meta.category = categories.find((c) => c !== 'global') || meta.category;
  }

  const brokenState = {
    rootCause: extracted.brokenState?.rootCause?.trim() || '',
    validationSymptoms: normalizeValidationSymptoms(extracted.brokenState?.validationSymptoms),
  };

  return {
    description: extracted.description.trim(),
    meta,
    catalogueCategories: meta.catalogueCategories,
    arch: extracted.arch?.trim() || '',
    infra: { services: normalizeServiceList(extracted.infra?.services) },
    brokenState,
    metricsIntent: extracted.metricsIntent || null,
  };
}

/** Parse Phase 1 agent output into a normalized design contract. */
function extractShapeContract(text) {
  const contractRaw = extractTag(text, 'shape_contract');
  const contract = parseShapeContractTag(contractRaw);
  if (contract?.description) {
    return normalizeExtracted({
      description: contract.description,
      meta: contract.meta,
      catalogueCategories: contract.meta?.catalogueCategories,
      arch: contract.arch,
      infra: contract.infra,
      brokenState: contract.brokenState,
      metricsIntent: contract.metricsIntent,
    });
  }

  const description = extractTag(text, 'problem_statement');
  if (!description) return null;

  const out = { description };

  const metaRaw = extractTag(text, 'shape_meta');
  if (metaRaw) {
    try { out.meta = JSON.parse(metaRaw); } catch (e) {
      console.warn('[shapeContract] shape_meta parse failed:', e.message);
    }
  }

  const categoriesRaw = extractTag(text, 'catalogue_categories');
  const parsedCategories = parseCatalogueCategoriesTag(categoriesRaw);
  if (parsedCategories.length) out.catalogueCategories = sanitizeCatalogueCategories(parsedCategories);

  const rootCause = extractTag(text, 'root_cause');
  if (rootCause) out.brokenState = { rootCause };

  const arch = extractTag(text, 'arch_intent') || extractTag(text, 'arch');
  if (arch) out.arch = arch;

  const servicesRaw = extractTag(text, 'services');
  if (servicesRaw) {
    try {
      const parsed = JSON.parse(servicesRaw);
      out.infra = { services: normalizeServiceList(parsed) };
    } catch (e) {
      console.warn('[shapeContract] services parse failed:', e.message);
    }
  }

  const validationRaw = extractTag(text, 'validation_intent');
  if (validationRaw) {
    try {
      const parsed = JSON.parse(validationRaw);
      out.brokenState = {
        ...(out.brokenState || {}),
        validationSymptoms: normalizeValidationSymptoms(parsed),
      };
    } catch (e) {
      console.warn('[shapeContract] validation_intent parse failed:', e.message);
    }
  }

  const metricsRaw = extractTag(text, 'metrics_intent');
  if (metricsRaw) {
    try { out.metricsIntent = JSON.parse(metricsRaw); } catch (_e) { /* noop */ }
  }

  return normalizeExtracted(out);
}

function applyShapeContractToDraft(draft, extracted) {
  if (!extracted) return draft;
  const next = draft || { schemaVersion: 1 };

  next.description = extracted.description;
  next.meta = { ...(next.meta || {}), ...(extracted.meta || {}) };
  if (extracted.catalogueCategories?.length) {
    next.meta.catalogueCategories = extracted.catalogueCategories;
  }
  if (extracted.arch) next.arch = extracted.arch;
  if (extracted.infra?.services?.length) {
    next.infra = stripInfraImplementation(extracted.infra);
  } else if (next.infra?.services?.length) {
    next.infra = stripInfraImplementation(next.infra);
  }
  next.brokenState = {
    ...(next.brokenState || {}),
    rootCause: extracted.brokenState?.rootCause || next.brokenState?.rootCause || '',
    validationSymptoms: extracted.brokenState?.validationSymptoms?.length
      ? extracted.brokenState.validationSymptoms
      : (next.brokenState?.validationSymptoms || []),
  };
  if (extracted.metricsIntent) {
    next.metrics = next.metrics || {};
    if (extracted.metricsIntent.enabled != null) next.metrics.enabled = extracted.metricsIntent.enabled;
    if (extracted.metricsIntent.guidance) {
      next.metrics.display = {
        ...(next.metrics.display || {}),
        guidance: extracted.metricsIntent.guidance,
      };
    }
  }
  return next;
}

function validateShapeContract(draft) {
  const missing = [];
  if (!draft?.description?.trim()) missing.push('description');
  const cats = draft?.meta?.catalogueCategories || [];
  if (!cats.filter((c) => c !== 'global').length) missing.push('meta.catalogueCategories');
  if (!draft?.meta?.name?.trim()) missing.push('meta.name');
  if (!draft?.meta?.category?.trim()) missing.push('meta.category');
  if (!draft?.meta?.difficulty?.trim()) missing.push('meta.difficulty');
  if (!draft?.arch?.trim()) missing.push('arch');
  if (!draft?.brokenState?.rootCause?.trim()) missing.push('brokenState.rootCause');
  const symptoms = draft?.brokenState?.validationSymptoms || [];
  if (!symptoms.length) missing.push('brokenState.validationSymptoms');
  const services = draft?.infra?.services || [];
  if (!services.length) missing.push('infra.services');
  return { ok: missing.length === 0, missing };
}

function coalesceServiceList(services) {
  if (!Array.isArray(services)) return [];
  return services
    .map((s) => {
      if (typeof s === 'string') return { name: s.trim() };
      if (s && typeof s === 'object' && s.name) {
        return { ...s, name: String(s.name).trim() };
      }
      return null;
    })
    .filter((s) => s?.name);
}

function mergeInfraServices(lockedServices, generatedServices) {
  const locked = normalizeServiceList(lockedServices);
  const genMap = new Map(coalesceServiceList(generatedServices).map((s) => [s.name, s]));
  const merged = locked.map((s) => {
    const gen = genMap.get(s.name);
    return gen ? { ...gen, name: s.name } : { name: s.name };
  });
  for (const [name, svc] of genMap) {
    if (!merged.some((m) => m.name === name)) merged.push(svc);
  }
  return merged;
}

/** After Phase 2 LLM output — preserve Phase 1 design contract fields. */
function mergeLockedPhase1Fields(phase1Draft, generatedRaw) {
  const locked = phase1Draft || {};
  const gen = generatedRaw || {};

  const meta = {
    ...(gen.meta || {}),
    ...(locked.meta || {}),
    catalogueCategories: locked.meta?.catalogueCategories || gen.meta?.catalogueCategories,
  };

  const metrics = {
    ...(gen.metrics || {}),
    enabled: locked.metrics?.enabled ?? gen.metrics?.enabled,
    display: {
      ...(gen.metrics?.display || {}),
      ...(locked.metrics?.display?.guidance
        ? { guidance: locked.metrics.display.guidance }
        : {}),
    },
  };

  return {
    ...gen,
    description: locked.description,
    meta,
    arch: locked.arch || gen.arch,
    infra: {
      ...(gen.infra || {}),
      services: mergeInfraServices(
        locked.infra?.services,
        gen.infra?.services,
      ),
    },
    brokenState: {
      rootCause: locked.brokenState?.rootCause || gen.brokenState?.rootCause || '',
      validationSymptoms: locked.brokenState?.validationSymptoms?.length
        ? locked.brokenState.validationSymptoms
        : (gen.brokenState?.validationSymptoms || []),
    },
    metrics,
  };
}

function parseChallengeDraftFromText(text) {
  const re = /<challenge_draft>([\s\S]*?)<\/challenge_draft>/gi;
  let last = null;
  let m;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (!last) return null;
  try {
    return JSON.parse(last.trim());
  } catch (e) {
    console.warn('[shapeContract] challenge_draft parse failed:', e.message);
    return null;
  }
}

function storedServicesMissingImageHints(draft) {
  return (draft?.infra?.services || []).some((s) => {
    const svc = typeof s === 'string' ? { name: s } : s;
    return !svc?.image_hint?.trim();
  });
}

/** Re-apply challenge_draft from chat when a prior merge stripped image_hint values. */
function repairSchemaFromMessages(session) {
  const { isDraftReady, normalizeDraft } = require('../draft/draftSchema');
  if (!session?.designApproved) return false;
  if (isDraftReady(session.draft) && !storedServicesMissingImageHints(session.draft)) return false;

  const messages = session.messages || [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !String(msg.content || '').includes('<challenge_draft>')) continue;
    const raw = parseChallengeDraftFromText(msg.content);
    if (!raw) continue;
    const normalized = normalizeDraft(mergeLockedPhase1Fields(session.draft, raw));
    if (!isDraftReady(normalized)) continue;
    session.draft = normalized;
    session.schemaMaterialized = true;
    session.designApproved = true;
    session.shapePhase = 'ready';
    return true;
  }
  return false;
}

module.exports = {
  SHAPE_CONTRACT_HINT,
  extractShapeContract,
  applyShapeContractToDraft,
  validateShapeContract,
  mergeLockedPhase1Fields,
  normalizeServiceList,
  stripInfraImplementation,
  parseChallengeDraftFromText,
  repairSchemaFromMessages,
  storedServicesMissingImageHints,
};
