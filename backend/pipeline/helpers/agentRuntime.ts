'use strict';

/**
 * LLM runtime helpers shared across agents.
 *
 * Build pipeline: assertLlmConfigured (design/schema/validation)
 * Authoring:      streamWithEvents (design, schema chat agents)
 *
 * CODE agent uses Claude Agent SDK directly — see codeAgentHarness.ts.
 */

import type { BuildEventHandler } from '../../types/domain';

const llm = require('../../llm/client');
const { modelIdFor, providerOf, isKeyConfiguredFor } = require('../../llm/models');

/** Build a clear error when the API key for an agent's provider is missing. */
function llmConfigError(agentKey: string, label?: string): Error {
  const provider = providerOf(modelIdFor(agentKey));
  const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const who = label || `${agentKey} agent`;
  const e = new Error(
    `${keyName} is not configured. Set it in backend/.env to use the ${who}.`,
  ) as Error & { code?: string };
  e.code = 'LLM_NOT_CONFIGURED';
  return e;
}

/** Ensure the provider for a given agent key has its API key set. */
function assertLlmConfigured(agentKey: string, { label }: { label?: string } = {}): void {
  const provider = providerOf(modelIdFor(agentKey));
  if (!provider || !isKeyConfiguredFor(provider)) throw llmConfigError(agentKey, label);
}

interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Stream one LLM turn for authoring chat agents (design, schema).
 * Forwards text deltas to onEvent as { type: 'text', delta }.
 */
async function streamWithEvents({
  agent,
  system,
  messages,
  maxTokens = 8192,
  onEvent,
  emitDone = true,
}: {
  agent: string;
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
  onEvent?: BuildEventHandler;
  emitDone?: boolean;
}): Promise<string> {
  assertLlmConfigured(agent);

  let fullText = '';
  try {
    const streamed = await llm.streamMessage({
      agent,
      system,
      messages,
      maxTokens,
      onText: (delta: string) => onEvent?.({ type: 'text', delta } as never),
    });
    fullText = streamed.text;
  } catch (e) {
    onEvent?.({ type: 'error', message: (e as Error).message } as never);
    throw e;
  }

  if (emitDone) onEvent?.({ type: 'done' } as never);
  return fullText;
}

module.exports = {
  llmConfigError,
  assertLlmConfigured,
  streamWithEvents,
};
