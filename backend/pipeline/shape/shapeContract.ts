'use strict';

import type { ChallengeDraft, DraftMeta, DraftBrokenState, DraftInfra } from '../../types/domain';

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
  "description": "FULL candidate-facing problem statement (markdown OK, qualitative only). Describe symptoms and context only — do NOT reveal brokenState.rootCause or the fix.",
  "arch": "how named services connect — qualitative, no Docker tags",
  "infra": {
    "services": [{ "name": "orders-service" }, { "name": "postgres" }, { "name": "load-generator" }]
  },
  "brokenState": {
    "rootCause": "exact technical root cause (setter-only)",
    "validationSymptoms": [
      { "id": 1, "check": "Concrete observable probe: e.g. GET /products/1 returns X, then PUT /products/1 with new value, then GET /products/1 again — still returns old X (stale data served)." },
      { "id": 2, "check": "Another probe a candidate would run that further confirms the bug is present." }
    ]
  }
}`;

interface ServiceName {
  name: string;
  [key: string]: unknown;
}

interface ValidationSymptom {
  id?: number;
  order?: number;
  check: string;
}

interface ShapeContractData {
  description: string;
  meta?: DraftMeta & { catalogueCategories?: string[] };
  catalogueCategories?: string[];
  arch?: string;
  infra?: DraftInfra;
  brokenState?: DraftBrokenState;
}

function extractTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m[1];
  return last ? last.trim() : null;
}

function normalizeServiceList(services: unknown[]): ServiceName[] {
  if (!Array.isArray(services)) return [];
  return services
    .map((s) => {
      if (typeof s === 'string') return { name: s.trim() };
      if (s && typeof s === 'object' && (s as ServiceName).name) return { name: String((s as ServiceName).name).trim() };
      return null;
    })
    .filter((s): s is ServiceName => s !== null && !!s.name);
}

/** Phase 1 keeps service names only — strip catalogue implementation fields. */
function stripInfraImplementation(infra: DraftInfra | null | undefined): DraftInfra {
  if (!infra?.services?.length) return { services: [] };
  return { services: normalizeServiceList(infra.services) };
}

function normalizeValidationSymptoms(symptoms: unknown[]): ValidationSymptom[] {
  if (!Array.isArray(symptoms)) return [];
  return symptoms
    .map((s, i) => {
      if (typeof s === 'string' && (s as string).trim()) {
        return { id: i + 1, check: (s as string).trim() };
      }
      if (s && typeof s === 'object' && (s as ValidationSymptom).check) {
        const sym = s as ValidationSymptom;
        return { id: sym.id ?? sym.order ?? i + 1, check: String(sym.check!).trim() };
      }
      return null;
    })
    .filter((s) => s !== null && 'check' in (s as object) && !!(s as ValidationSymptom).check) as ValidationSymptom[];
}

function parseShapeContractTag(raw: string | null): ShapeContractData | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[shapeContract] JSON parse failed:', (e as Error).message);
    return null;
  }
}

function normalizeExtracted(extracted: ShapeContractData | null): ShapeContractData | null {
  if (!extracted?.description?.trim()) return null;

  const meta: DraftMeta & { catalogueCategories?: string[] } = { ...(extracted.meta || {}) };
  const categories = extracted.catalogueCategories?.length
    ? extracted.catalogueCategories
    : sanitizeCatalogueCategories(meta.catalogueCategories || []);
  if (categories.length) meta.catalogueCategories = categories;
  if (!meta.category && categories.length) {
    meta.category = categories.find((c: string) => c !== 'global') || meta.category;
  }

  const brokenState: DraftBrokenState = {
    rootCause: extracted.brokenState?.rootCause?.trim() || '',
    validationSymptoms: normalizeValidationSymptoms(extracted.brokenState?.validationSymptoms || []),
  };

  return {
    description: extracted.description.trim(),
    meta,
    catalogueCategories: meta.catalogueCategories,
    arch: extracted.arch?.trim() || '',
    infra: { services: normalizeServiceList(extracted.infra?.services || []) },
    brokenState,
  };
}

/** Parse Phase 1 agent output into a normalized design contract. */
function extractShapeContract(text: string): ShapeContractData | null {
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
    });
  }

  const description = extractTag(text, 'problem_statement');
  if (!description) return null;

  const out: ShapeContractData = { description };

  const metaRaw = extractTag(text, 'shape_meta');
  if (metaRaw) {
    try { out.meta = JSON.parse(metaRaw); } catch (e) {
      console.warn('[shapeContract] shape_meta parse failed:', (e as Error).message);
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
      console.warn('[shapeContract] services parse failed:', (e as Error).message);
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
      console.warn('[shapeContract] validation_intent parse failed:', (e as Error).message);
    }
  }

  return normalizeExtracted(out);
}

function applyShapeContractToDraft(draft: ChallengeDraft | null, extracted: ShapeContractData | null): ChallengeDraft {
  if (!extracted) return draft || {};
  const next: ChallengeDraft = draft || { schemaVersion: 1 };

  next.description = extracted.description;
  next.meta = { ...(next.meta || {}), ...(extracted.meta || {}) };
  if (extracted.catalogueCategories?.length) {
    next.meta!.catalogueCategories = extracted.catalogueCategories;
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
  return next;
}

function validateShapeContract(draft: ChallengeDraft | null | undefined): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
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

function coalesceServiceList(services: unknown[]): ServiceName[] {
  if (!Array.isArray(services)) return [];
  return services
    .map((s) => {
      if (typeof s === 'string') return { name: (s as string).trim() };
      if (s && typeof s === 'object' && (s as ServiceName).name) {
        return { ...(s as Record<string, unknown>), name: String((s as ServiceName).name).trim() };
      }
      return null;
    })
    .filter((s): s is ServiceName => s !== null && !!s.name);
}

function mergeInfraServices(
  lockedServices: unknown[] | undefined,
  generatedServices: unknown[] | undefined,
): ServiceName[] {
  const locked = normalizeServiceList(lockedServices || []);
  const genMap = new Map<string, ServiceName>(coalesceServiceList(generatedServices || []).map((s) => [s.name, s]));
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
function mergeLockedPhase1Fields(
  phase1Draft: ChallengeDraft | null | undefined,
  generatedRaw: ChallengeDraft | null | undefined,
): ChallengeDraft {
  const locked = phase1Draft || {};
  const gen = generatedRaw || {};

  const meta: DraftMeta = {
    ...(gen.meta || {}),
    ...(locked.meta || {}),
    catalogueCategories: locked.meta?.catalogueCategories || gen.meta?.catalogueCategories,
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
    metrics: gen.metrics || {},
  };
}

function parseChallengeDraftFromText(text: string): ChallengeDraft | null {
  const re = /<challenge_draft>([\s\S]*?)<\/challenge_draft>/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (!last) return null;
  try {
    return JSON.parse(last.trim());
  } catch (e) {
    console.warn('[shapeContract] challenge_draft parse failed:', (e as Error).message);
    return null;
  }
}

function storedServicesMissingImageHints(draft: ChallengeDraft | null | undefined): boolean {
  return (draft?.infra?.services || []).some((s) => {
    const svc = typeof s === 'string' ? { name: s, image_hint: null } : s;
    return !svc?.image_hint?.trim();
  });
}

/** Re-apply challenge_draft from chat when a prior merge stripped image_hint values. */
function repairSchemaFromMessages(session: Record<string, unknown>): boolean {
  const { isDraftReady, normalizeDraft } = require('../draft/draftSchema');
  if (!session?.designApproved) return false;
  if (isDraftReady(session.draft) && !storedServicesMissingImageHints(session.draft as ChallengeDraft)) return false;

  const messages = (session.messages as Array<{ role: string; content: string }>) || [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !String(msg.content || '').includes('<challenge_draft>')) continue;
    const raw = parseChallengeDraftFromText(msg.content);
    if (!raw) continue;
    const normalized = normalizeDraft(mergeLockedPhase1Fields(session.draft as ChallengeDraft, raw));
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
