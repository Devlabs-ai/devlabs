'use strict';

// Shared LLM wiring for streaming authoring agents (design, schema, …).
// Orchestrators like buildPipeline should call assertLlmConfigured directly;
// validationAgent keeps its own optional-LLM policy.

import type { BuildEventHandler } from '../../types/domain';

const llm = require('../../llm/client');
const { modelIdFor, providerOf } = require('../../llm/models');
const { formatCostUsd } = require('../../llm/cost');

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

function assertLlmConfigured(agentKey: string, { label }: { label?: string } = {}): void {
  if (!llm.isConfigured()) throw llmConfigError(agentKey, label);
}

interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface LlmResult {
  text: string;
  modelId?: string;
  usage?: unknown;
}

function emitCodeLog(onEvent: BuildEventHandler | undefined, message: string): void {
  onEvent?.({
    type: 'log',
    level: 'info',
    tag: 'code',
    message,
  } as never);
  console.log(`[code] ${message}`);
}

function formatToolArgs(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const args = input as Record<string, unknown>;
  switch (toolName) {
    case 'write_file':
      return `path=${args.path}, bytes=${String(args.content || '').length}`;
    case 'edit_file':
      return `path=${args.path}, old_len=${String(args.old_string || '').length}, new_len=${String(args.new_string || '').length}`;
    case 'read_file': {
      const parts = [`path=${args.path}`];
      if (args.startLine) parts.push(`start=${args.startLine}`);
      if (args.endLine) parts.push(`end=${args.endLine}`);
      return parts.join(', ');
    }
    case 'list_files':
      return args.subpath ? `subpath=${args.subpath}` : '(root)';
    case 'grep':
      return `pattern=${JSON.stringify(args.pattern)}${args.path ? `, path=${args.path}` : ''}`;
    case 'search_code':
      return `query=${JSON.stringify(String(args.query || '').slice(0, 120))}`;
    default:
      try {
        const s = JSON.stringify(input);
        return s.length > 160 ? `${s.slice(0, 160)}…` : s;
      } catch (_e) {
        return '';
      }
  }
}

function formatToolResult(toolName: string, output: unknown): string {
  if (!output || typeof output !== 'object') return '';
  const o = output as Record<string, unknown>;
  if (o.error) return `error=${o.error}`;
  if (toolName === 'list_files' && Array.isArray(o.files)) {
    return `files=${o.files.length}`;
  }
  if (toolName === 'grep' && Array.isArray(o.matches)) {
    return `matches=${o.matches.length}`;
  }
  if (toolName === 'search_code' && Array.isArray(o.hits)) {
    return `hits=${o.hits.length}`;
  }
  if (toolName === 'read_file' && typeof o.content === 'string') {
    return `chars=${o.content.length}`;
  }
  if (typeof o.path === 'string' && typeof o.bytes === 'number') {
    return `path=${o.path}, bytes=${o.bytes}`;
  }
  return o.ok === true ? 'ok' : '';
}

/**
 * Stream an LLM turn and forward { type: 'text', delta } / { type: 'error' } to onEvent.
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

async function completeForAgent({
  agent,
  system,
  messages,
  maxTokens = 8192,
}: {
  agent: string;
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
}): Promise<LlmResult> {
  assertLlmConfigured(agent);
  const result: LlmResult = await llm.completeMessage({ agent, system, messages, maxTokens });
  return result;
}

/**
 * Multi-step tool loop for agents (code agent CODE phase).
 */
async function runAgentWithTools({
  agent,
  system,
  messages,
  tools,
  maxSteps = 20,
  maxTokens = 16384,
  onEvent,
  label = 'tools',
}: {
  agent: string;
  system: string;
  messages: LlmMessage[];
  tools: Record<string, unknown>;
  maxSteps?: number;
  maxTokens?: number;
  onEvent?: BuildEventHandler;
  label?: string;
}): Promise<LlmResult & { stepCount: number; totalMs?: number }> {
  assertLlmConfigured(agent);
  emitCodeLog(onEvent, `LLM tool loop starting (${label}, max ${maxSteps} steps)…`);

  const result = await llm.runToolLoop({
    agent,
    system,
    messages,
    tools,
    maxSteps,
    maxTokens,
    onStep: (step: {
      stepIndex: number;
      llmMs: number;
      usage: { inputTokens: number; outputTokens: number };
      costUsd: number;
      modelId: string;
      toolCalls: Array<{ toolName: string; input?: unknown }>;
      toolResults: Array<{ toolName: string; input?: unknown; output?: unknown }>;
      text?: string;
    }) => {
      const { stepIndex, llmMs, usage, costUsd, modelId, toolCalls, toolResults } = step;
      const llmLine = `LLM step ${stepIndex + 1}: ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out tokens — ${formatCostUsd(costUsd)} — ${(llmMs / 1000).toFixed(1)}s (${modelId})`;
      emitCodeLog(onEvent, llmLine);

      for (const tr of toolResults) {
        const argStr = formatToolArgs(tr.toolName, tr.input);
        const resStr = formatToolResult(tr.toolName, tr.output);
        const line = `Tool ${tr.toolName}${argStr ? `(${argStr})` : ''}${resStr ? ` → ${resStr}` : ''}`;
        emitCodeLog(onEvent, line);
        onEvent?.({
          type: 'tool',
          name: tr.toolName,
          step: stepIndex,
          argsPreview: argStr,
          resultPreview: resStr,
        } as never);
      }

      for (const tc of toolCalls) {
        if (toolResults.some((tr) => tr.toolName === tc.toolName)) continue;
        const argStr = formatToolArgs(tc.toolName, tc.input);
        emitCodeLog(onEvent, `Tool call ${tc.toolName}${argStr ? `(${argStr})` : ''} (pending)`);
      }
    },
  });

  const totalCost = formatCostUsd(
    result.steps?.reduce((s: number, st: { costUsd?: number }) => s + (st.costUsd || 0), 0) || 0,
  );
  emitCodeLog(
    onEvent,
    `LLM tool loop done: ${result.stepCount} step(s), ${(result.totalMs / 1000).toFixed(1)}s total, est. ${totalCost}`,
  );

  return {
    text: result.text,
    modelId: result.modelId,
    usage: result.usage,
    stepCount: result.stepCount,
    totalMs: result.totalMs,
    label,
  } as LlmResult & { stepCount: number; label: string; totalMs: number };
}

module.exports = {
  llmConfigError,
  assertLlmConfigured,
  streamWithEvents,
  completeForAgent,
  runAgentWithTools,
};
