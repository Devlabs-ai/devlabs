'use strict';

// Phase 1: DESIGN CONTRACT agent.

import type { BuildEventHandler } from '../../types/domain';

const { streamWithEvents } = require('../helpers/agentRuntime');
const { extractShapeContract } = require('../shape/shapeContract');
const { buildSystemPrompt } = require('../prompts/designAgent.prompt');

interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

async function streamDesignTurn({
  messages,
  onEvent,
}: {
  messages: LlmMessage[];
  onEvent: BuildEventHandler;
}): Promise<{ fullText: string; extracted: ReturnType<typeof extractShapeContract> }> {
  const fullText: string = await streamWithEvents({
    agent: 'design',
    system: buildSystemPrompt(),
    messages,
    maxTokens: 8192,
    onEvent,
    emitDone: false,
  });

  const extracted = extractShapeContract(fullText);
  if (extracted) onEvent({ type: 'design', extracted } as never);
  onEvent({ type: 'done' } as never);
  return { fullText, extracted };
}

module.exports = {
  buildSystemPrompt,
  extractShapeContract,
  streamDesignTurn,
};
