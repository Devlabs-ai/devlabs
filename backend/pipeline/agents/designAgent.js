'use strict';

// Phase 1: DESIGN CONTRACT agent.
//
// Holds a streaming chat with the interviewer to nail down the challenge
// shape — story, catalogue categories, service names, root cause, validation
// intent. Emits <shape_contract> JSON when ready. Never emits a full v1
// challenge_draft (that's Phase 2 / schemaAgent).
//
// LLM model is resolved from the 'design' registry key in backend/llm/models.js
// (override with LLM_MODEL_DESIGN; default openai:gpt-4o).

const { streamWithEvents } = require('../helpers/agentRuntime');
const { extractShapeContract } = require('../shape/shapeContract');
const { buildSystemPrompt } = require('../prompts/designAgent.prompt');

async function streamDesignTurn({ messages, onEvent }) {
  const fullText = await streamWithEvents({
    agent: 'design',
    system: buildSystemPrompt(),
    messages,
    maxTokens: 8192,
    onEvent,
    emitDone: false,
  });

  const extracted = extractShapeContract(fullText);
  if (extracted) onEvent({ type: 'design', extracted });
  onEvent({ type: 'done' });
  return { fullText, extracted };
}

module.exports = {
  buildSystemPrompt,
  extractShapeContract,
  streamDesignTurn,
};
