'use strict';

const llm = require('../../llm/client');
const { listAvailableCategoryKeys } = require('../catalogue/catalogueCategories');
const {
  SHAPE_CONTRACT_HINT,
  extractShapeContract,
} = require('../shape/shapeContract');

function buildSystemPrompt() {
  const categories = listAvailableCategoryKeys();
  const categoryList = categories.length
    ? categories.join(', ')
    : '(catalogue not loaded — use standard keys: postgres, redis, python, load-generator, apache-kafka, …)';

  return `You are the Problem Design Agent for "Devlabs" — Phase 1: DESIGN CONTRACT.

Your job is to help the interviewer define the FULL challenge intent in one coherent pass:
candidate story, catalogue rows, architecture, service names, root cause, and qualitative validation.
Phase 2 only materializes Docker images, limits, codebase paths, and data from the catalogue — it must NOT re-invent the incident.

WORKFLOW:
1. Ask clarifying questions when the idea is vague.
2. When you have enough detail, emit ONE structured design contract:
   <shape_contract>...</shape_contract>
   Strict JSON inside the tag (see schema below). All required fields must be present.
3. Optionally repeat the candidate story outside the tag for readability, but the contract JSON is authoritative.

${SHAPE_CONTRACT_HINT}

catalogueCategories must use ONLY keys from:
${categoryList}

RULES:
- Do NOT emit <challenge_draft> or full v1 schema JSON.
- description is QUALITATIVE — no fake p99, RPS, or SLA numbers.
- infra.services: NAMES ONLY — never include image_hint, limits, or env in Phase 1
- validationSymptoms: qualitative broken vs fixed behavior — not shell commands or HTTP status codes yet.
- rootCause is setter-only; do not put it in description.
- After emitting <shape_contract>, summarise and ask if the author wants changes or is ready to approve.`;
}

async function streamDescriptionTurn({ messages, onEvent }) {
  if (!llm.isConfigured()) {
    const provider = llm.getProvider();
    const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    const e = new Error(
      `${keyName} is not configured. Set it in backend/.env to use the design agent.`,
    );
    e.code = 'LLM_NOT_CONFIGURED';
    throw e;
  }

  let fullText = '';
  try {
    fullText = await llm.streamMessage({
      system: buildSystemPrompt(),
      messages,
      maxTokens: 8192,
      onText: (delta) => onEvent({ type: 'text', delta }),
    });
  } catch (e) {
    onEvent({ type: 'error', message: e.message });
    throw e;
  }

  const extracted = extractShapeContract(fullText);
  if (extracted) onEvent({ type: 'description', extracted });
  onEvent({ type: 'done' });
  return { fullText, extracted };
}

module.exports = {
  buildSystemPrompt,
  extractDescriptionPayload: extractShapeContract,
  extractShapeContract,
  streamDescriptionTurn,
};
