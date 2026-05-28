'use strict';

// Shared LLM wiring for streaming authoring agents (design, schema, …).
// Orchestrators like buildPipeline should call assertLlmConfigured directly;
// validationAgent keeps its own optional-LLM policy.

const llm = require('../../llm/client');
const { modelIdFor, providerOf } = require('../../llm/models');

function llmConfigError(agentKey, label) {
  const provider = providerOf(modelIdFor(agentKey));
  const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const who = label || `${agentKey} agent`;
  const e = new Error(
    `${keyName} is not configured. Set it in backend/.env to use the ${who}.`,
  );
  e.code = 'LLM_NOT_CONFIGURED';
  return e;
}

function assertLlmConfigured(agentKey, { label } = {}) {
  if (!llm.isConfigured()) throw llmConfigError(agentKey, label);
}

/**
 * Stream an LLM turn and forward { type: 'text', delta } / { type: 'error' } to onEvent.
 * @returns {Promise<string>} full assistant text
 */
async function streamWithEvents({
  agent,
  system,
  messages,
  maxTokens = 8192,
  onEvent,
  emitDone = true,
}) {
  assertLlmConfigured(agent);

  let fullText = '';
  try {
    fullText = await llm.streamMessage({
      agent,
      system,
      messages,
      maxTokens,
      onText: (delta) => onEvent?.({ type: 'text', delta }),
    });
  } catch (e) {
    onEvent?.({ type: 'error', message: e.message });
    throw e;
  }

  if (emitDone) onEvent?.({ type: 'done' });
  return fullText;
}

/**
 * Single-shot LLM completion for an agent registry key (e.g. code, validation).
 * @returns {Promise<string>} full assistant text
 */
async function completeForAgent({
  agent,
  system,
  messages,
  maxTokens = 8192,
}) {
  assertLlmConfigured(agent);
  return llm.completeMessage({ agent, system, messages, maxTokens });
}

module.exports = {
  llmConfigError,
  assertLlmConfigured,
  streamWithEvents,
  completeForAgent,
};
