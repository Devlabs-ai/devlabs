'use strict';

/**
 * LLM runtime helpers shared across agents.
 *
 * Build pipeline: assertLlmConfigured, runAgentWithTools (CODE agent)
 * Authoring:      streamWithEvents (design, schema chat agents)
 */

import type { BuildEventHandler } from '../../types/domain';

const llm = require('../../llm/client');
const { modelIdFor, providerOf, isKeyConfiguredFor } = require('../../llm/models');
const { formatCostUsd } = require('../../llm/cost');

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

interface LlmResult {
  text: string;
  modelId?: string;
  usage?: unknown;
}

function emitCodeLog(onEvent: BuildEventHandler | undefined, message: string): void {
  onEvent?.({ type: 'log', level: 'info', tag: 'code', message } as never);
  console.log(`[code] ${message}`);
}

/** Summarize a batch of tool calls into one compact line (e.g. write_file×3, read_file×2). */
function summarizeToolBatch(toolResults: Array<{ toolName: string; input?: unknown; output?: unknown }>): string {
  if (!toolResults.length) return 'no tools';
  const counts = new Map<string, number>();
  for (const tr of toolResults) {
    counts.set(tr.toolName, (counts.get(tr.toolName) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, n]) => (n > 1 ? `${name}×${n}` : name))
    .join(', ');
}

/** Short human hint for what the model did in this step. */
function toolStepHint(toolResults: Array<{ toolName: string; input?: unknown; output?: unknown }>): string {
  const parts: string[] = [];
  for (const tr of toolResults.slice(0, 4)) {
    const args = tr.input as Record<string, unknown> | undefined;
    if (tr.toolName === 'write_file' && args?.path) parts.push(`wrote ${args.path}`);
    else if (tr.toolName === 'write_files') {
      const out = tr.output as { count?: number; written?: Array<{ path: string }> } | undefined;
      const n = out?.count ?? out?.written?.length ?? (args?.files as unknown[] | undefined)?.length;
      parts.push(n ? `wrote ${n} files` : 'wrote batch');
    }
    else if (tr.toolName === 'edit_file' && args?.path) parts.push(`edited ${args.path}`);
    else if (tr.toolName === 'read_file' && args?.path) parts.push(`read ${args.path}`);
    else if (tr.toolName === 'list_files') parts.push(args?.subpath ? `listed ${args.subpath}` : 'listed workspace');
    else if (tr.toolName === 'grep' && args?.pattern) parts.push(`grep ${String(args.pattern).slice(0, 40)}`);
    else parts.push(tr.toolName);
  }
  if (toolResults.length > 4) parts.push(`+${toolResults.length - 4} more`);
  return parts.join(' · ');
}

/** One-line summary of tool arguments for build logs. */
function formatToolArgs(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const args = input as Record<string, unknown>;
  switch (toolName) {
    case 'write_file':
      return `path=${args.path}, bytes=${String(args.content || '').length}`;
    case 'edit_file':
      return `path=${args.path}`;
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
    default:
      try {
        const s = JSON.stringify(input);
        return s.length > 160 ? `${s.slice(0, 160)}…` : s;
      } catch (_e) {
        return '';
      }
  }
}

/** One-line summary of tool results for build logs. */
function formatToolResult(toolName: string, output: unknown): string {
  if (!output || typeof output !== 'object') return '';
  const o = output as Record<string, unknown>;
  if (o.error) return `error=${o.error}`;
  if (toolName === 'list_files' && Array.isArray(o.files)) return `files=${o.files.length}`;
  if (toolName === 'grep' && Array.isArray(o.matches)) return `matches=${o.matches.length}`;
  if (toolName === 'read_file' && typeof o.content === 'string') return `chars=${o.content.length}`;
  if (typeof o.path === 'string' && typeof o.bytes === 'number') return `path=${o.path}, bytes=${o.bytes}`;
  return o.ok === true ? 'ok' : '';
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

/**
 * Multi-step tool loop for the CODE agent.
 * Logs each LLM step and tool call once (no duplicate tool-layer logging).
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
  promptCache = false,
  shouldContinue,
}: {
  agent: string;
  system: string;
  messages: LlmMessage[];
  tools: Record<string, unknown>;
  maxSteps?: number;
  maxTokens?: number;
  onEvent?: BuildEventHandler;
  label?: string;
  promptCache?: boolean;
  shouldContinue?: (step: {
    stepIndex: number;
    toolResults: Array<{ toolName: string; input?: unknown; output?: unknown }>;
    text?: string;
  }) => boolean;
}): Promise<LlmResult & { stepCount: number; totalMs?: number }> {
  assertLlmConfigured(agent);
  emitCodeLog(onEvent, `Tool loop (${label}, max ${maxSteps} steps)`);

  const result = await llm.runToolLoop({
    agent,
    system,
    messages,
    tools,
    maxSteps,
    maxTokens,
    promptCache,
    onThinking: ({ stepIndex, label }: { stepIndex: number; label: string }) => {
      onEvent?.({ type: 'thinking', step: stepIndex, label } as never);
    },
    onStep: (step: {
      stepIndex: number;
      llmMs: number;
      usage: { inputTokens: number; outputTokens: number };
      costUsd: number;
      modelId: string;
      toolResults: Array<{ toolName: string; input?: unknown; output?: unknown }>;
      text?: string;
    }) => {
      const { stepIndex, llmMs, usage, costUsd, toolResults, text } = step;
      const toolsSummary = summarizeToolBatch(toolResults);
      const hint = toolStepHint(toolResults);
      const tokens = `${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`;
      const costStr = formatCostUsd(costUsd);

      onEvent?.({
        type: 'codeStep',
        step: stepIndex,
        tools: toolsSummary,
        hint,
        ms: llmMs,
        cost: costStr,
        tokens,
        toolCount: toolResults.length,
        summary: text?.trim() ? text.trim().slice(0, 200) : null,
      } as never);

      const persistLine = toolResults.length
        ? `⚡ Step ${stepIndex + 1} · ${toolsSummary}${hint ? ` — ${hint}` : ''} · ${(llmMs / 1000).toFixed(1)}s · ${costStr} · ${tokens}`
        : `⚡ Step ${stepIndex + 1} · ${text?.trim() ? text.trim().slice(0, 120) : 'done'} · ${(llmMs / 1000).toFixed(1)}s · ${costStr} · ${tokens}`;
      emitCodeLog(onEvent, persistLine);
    },
    shouldContinue: shouldContinue
      ? (step: {
        stepIndex: number;
        toolResults: Array<{ toolName: string; input?: unknown; output?: unknown }>;
        text?: string;
      }) => shouldContinue({
        stepIndex: step.stepIndex,
        toolResults: step.toolResults,
        text: step.text,
      })
      : undefined,
  });

  const totalCost = formatCostUsd(
    result.steps?.reduce((s: number, st: { costUsd?: number }) => s + (st.costUsd || 0), 0) || 0,
  );
  emitCodeLog(
    onEvent,
    `Tool loop done: ${result.stepCount} step(s), ${(result.totalMs / 1000).toFixed(1)}s, est. ${totalCost}`,
  );

  return {
    text: result.text,
    modelId: result.modelId,
    usage: result.usage,
    stepCount: result.stepCount,
    totalMs: result.totalMs,
  };
}

module.exports = {
  llmConfigError,
  assertLlmConfigured,
  streamWithEvents,
  runAgentWithTools,
};
