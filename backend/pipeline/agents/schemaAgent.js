'use strict';

const { streamWithEvents } = require('./agentRuntime');
const catalogueBrief = require('../catalogue/catalogueBrief');
const { loadDraftDefaults } = require('../catalogue/draftFromCatalogue');
const { primaryCategoryFromList, getExplicitCatalogueCategories } = require('../catalogue/catalogueCategories');
const { V1_SCHEMA_PROMPT } = require('../draft/draftSchema');

const SYSTEM_PROMPT = `You are the Schema Agent for "Devlabs" — Phase 2: MATERIALIZE v1 DRAFT JSON.

The interviewer has APPROVED a locked Phase 1 design contract.
You must emit schemaVersion: 1 inside <challenge_draft>...</challenge_draft>.

Phase 2 is IMPLEMENTATION ONLY. The payload includes lockedContract with fields finalized in Phase 1.
DO NOT change or contradict lockedContract.

The user payload includes:
- lockedContract: description, meta, arch, infra service names, brokenState, metricsIntent
- catalogueBrief: catalogue rows for catalogueCategories (images, limits, handbook, observables)
- catalogueDefaults: baseline infra/metrics from primary category draftDefaults

RULES:
1. Copy lockedContract.description, meta (including catalogueCategories), arch, brokenState verbatim.
2. For each service in lockedContract.infra.services, fill image_hint and limits from catalogueBrief — names must match exactly.
3. Do NOT add/remove/rename services unless lockedContract lists them.
4. App/API services use python row image_hint unless catalogue says otherwise.
5. Include load-generator with catalogue image when lockedContract.metricsIntent.enabled or metrics enabled.
6. Do NOT emit metrics.observed or metrics.observe (pipeline fills observe from catalogue).
7. Fill codebase.artifacts and data to support the locked story; refine validationSymptoms wording only if needed for build checks — keep the same meaning.
8. Emit strictly valid JSON inside <challenge_draft> tags only.

${V1_SCHEMA_PROMPT}`;

function extractDraft(text) {
  const re = /<challenge_draft>([\s\S]*?)<\/challenge_draft>/g;
  let last = null;
  let m;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (!last) return null;
  try {
    return JSON.parse(last.trim());
  } catch (e) {
    console.warn('[schemaAgent] draft JSON parse failed:', e.message);
    return null;
  }
}

function buildSchemaPayload(sessionDraft) {
  const category = sessionDraft?.meta?.category || sessionDraft?.category || 'general';
  const catalogueCategories = getExplicitCatalogueCategories(sessionDraft) || ['global'];
  const primaryCategory = primaryCategoryFromList(catalogueCategories) || category;
  const stub = {
    meta: {
      ...(sessionDraft?.meta || {}),
      catalogueCategories,
      category: sessionDraft?.meta?.category || primaryCategory,
    },
    category: sessionDraft?.meta?.category || primaryCategory,
    description: sessionDraft?.description || '',
    brokenState: sessionDraft?.brokenState || {},
    infra: sessionDraft?.infra || { services: [] },
  };
  const brief = catalogueBrief.buildBrief({ draft: stub });
  const defaults = loadDraftDefaults(primaryCategory);

  const lockedContract = {
    description: sessionDraft?.description || '',
    meta: stub.meta,
    arch: sessionDraft?.arch || '',
    infra: sessionDraft?.infra || { services: [] },
    brokenState: sessionDraft?.brokenState || { rootCause: '', validationSymptoms: [] },
    metricsIntent: {
      enabled: sessionDraft?.metrics?.enabled ?? false,
      guidance: sessionDraft?.metrics?.display?.guidance || '',
    },
  };

  return {
    lockedContract,
    catalogueCategories: brief.matchedCategories,
    catalogueBrief: brief,
    catalogueDefaults: {
      infra: defaults.infra,
      metrics: defaults.metrics,
    },
  };
}

async function generateSchema({ sessionDraft, onEvent }) {
  if (!sessionDraft?.description?.trim()) {
    const e = new Error('approved design contract is required before generating schema');
    e.status = 400;
    throw e;
  }

  const payload = buildSchemaPayload(sessionDraft);
  const userContent = JSON.stringify(payload, null, 2);

  const fullText = await streamWithEvents({
    agent: 'schema',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 8192,
    onEvent,
  });

  const raw = extractDraft(fullText);
  return { fullText, raw };
}

module.exports = {
  SYSTEM_PROMPT,
  buildSchemaPayload,
  generateSchema,
};
