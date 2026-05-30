'use strict';

const { streamWithEvents } = require('../helpers/agentRuntime');
const catalogueBrief = require('../catalogue/catalogueBrief');
const { loadDraftDefaults } = require('../catalogue/draftFromCatalogue');
const { primaryCategoryFromList, getExplicitCatalogueCategories } = require('../catalogue/catalogueCategories');
const { SYSTEM_PROMPT } = require('../prompts/schemaAgent.prompt');

function extractDraft(text) {
  // Primary: well-formed closing tag
  const re = /<challenge_draft>([\s\S]*?)<\/challenge_draft>/g;
  let last = null;
  let m;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (last) {
    try {
      return JSON.parse(last.trim());
    } catch (e) {
      console.warn('[schemaAgent] draft JSON parse failed:', e.message);
    }
  }

  // Fallback: response was truncated before </challenge_draft> — grab everything
  // after the opening tag and attempt to parse the (potentially incomplete) JSON.
  const openIdx = text.lastIndexOf('<challenge_draft>');
  if (openIdx === -1) return null;
  const fragment = text.slice(openIdx + '<challenge_draft>'.length).trim();
  try {
    return JSON.parse(fragment);
  } catch (_e) {
    console.warn('[schemaAgent] truncated draft parse also failed — response likely cut off mid-JSON');
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
    maxTokens: 16384,
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
