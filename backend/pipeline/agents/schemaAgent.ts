'use strict';

import type { ChallengeDraft, BuildEventHandler } from '../../types/domain';

const { streamWithEvents } = require('../helpers/agentRuntime');
const catalogueBrief = require('../catalogue/catalogueBrief');
const { loadDraftDefaults } = require('../catalogue/draftFromCatalogue');
const { primaryCategoryFromList, getExplicitCatalogueCategories } = require('../catalogue/catalogueCategories');
const { SYSTEM_PROMPT } = require('../prompts/schemaAgent.prompt');

function extractDraft(text: string): ChallengeDraft | null {
  // Primary: well-formed closing tag
  const re = /<challenge_draft>([\s\S]*?)<\/challenge_draft>/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (last) {
    try {
      return JSON.parse(last.trim());
    } catch (e) {
      console.warn('[schemaAgent] draft JSON parse failed:', (e as Error).message);
    }
  }

  // Fallback: response was truncated before </challenge_draft>
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

function buildSchemaPayload(sessionDraft: ChallengeDraft): Record<string, unknown> {
  const category = sessionDraft?.meta?.category || (sessionDraft as Record<string, unknown>)?.category as string || 'general';
  const catalogueCategories: string[] = getExplicitCatalogueCategories(sessionDraft) || ['global'];
  const primaryCategory = primaryCategoryFromList(catalogueCategories) || category;
  const stub: ChallengeDraft = {
    meta: {
      ...(sessionDraft?.meta || {}),
      catalogueCategories,
      category: sessionDraft?.meta?.category || primaryCategory,
    },
    category: sessionDraft?.meta?.category || primaryCategory,
    description: sessionDraft?.description || '',
    brokenState: sessionDraft?.brokenState || { rootCause: '', validationSymptoms: [] },
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

async function generateSchema({
  sessionDraft,
  onEvent,
}: {
  sessionDraft: ChallengeDraft;
  onEvent: BuildEventHandler;
}): Promise<{ fullText: string; raw: ChallengeDraft | null }> {
  if (!sessionDraft?.description?.trim()) {
    const e = new Error('approved design contract is required before generating schema') as Error & { status?: number };
    e.status = 400;
    throw e;
  }

  const payload = buildSchemaPayload(sessionDraft);
  const userContent = JSON.stringify(payload, null, 2);

  const fullText: string = await streamWithEvents({
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
