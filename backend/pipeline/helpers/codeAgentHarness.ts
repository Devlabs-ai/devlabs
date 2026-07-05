'use strict';

/**
 * CODE agent runtime — Claude Agent SDK (Claude Code harness).
 *
 * Replaces the legacy Vercel AI SDK tool loop + sandbox tool implementations.
 * Built-in Read / Write / Edit / Glob / Grep run in cwd with permissionMode acceptEdits.
 */

import * as path from 'path';

import type { BuildEventHandler } from '../../types/domain';

const { modelIdFor, providerOf, splitId, isKeyConfiguredFor } = require('../../llm/models');
const { validateWorkspaceToolPath, toolFilePath } = require('./buildWorkspacePaths');
const { formatCostUsd } = require('../../llm/cost');

const CODE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
const DISALLOWED_TOOLS = [
  'Bash',
  'WebSearch',
  'WebFetch',
  'Agent',
  'Skill',
  'Monitor',
  'NotebookEdit',
  'EnterPlanMode',
  'TaskCreate',
  'TodoWrite',
  'Workflow',
];

const WRITE_TOOLS = new Set(['Write', 'Edit']);
const PATH_JAILED_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep']);

type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk');

interface ToolUseSummary {
  name: string;
  input: Record<string, unknown>;
}

interface HarnessRunResult {
  text: string;
  stepCount: number;
  totalMs: number;
  hasWritten: boolean;
  modelId: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  costUsd: number;
}

let sdkPromise: Promise<SdkModule> | null = null;

function loadSdk(): Promise<SdkModule> {
  if (!sdkPromise) {
    sdkPromise = import('@anthropic-ai/claude-agent-sdk') as Promise<SdkModule>;
  }
  return sdkPromise;
}

/** CODE phase requires Anthropic — Claude Agent SDK spawns Claude Code CLI. */
function assertCodeHarnessConfigured(): void {
  if (!isKeyConfiguredFor('anthropic')) {
    const e = new Error(
      'ANTHROPIC_API_KEY is not configured. The CODE agent uses the Claude Agent SDK and requires Anthropic.',
    ) as Error & { code?: string };
    e.code = 'LLM_NOT_CONFIGURED';
    throw e;
  }
}

function resolveClaudeModel(): { model: string; modelId: string } {
  const modelId = modelIdFor('code');
  if (providerOf(modelId) === 'anthropic') {
    return { model: splitId(modelId).model, modelId };
  }
  const fallbackModel = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
  const fallbackId = `anthropic:${fallbackModel}`;
  console.warn(
    `[code] LLM_MODEL_CODE=${modelId} ignored — Claude Agent SDK requires Anthropic; using ${fallbackId}`,
  );
  return { model: fallbackModel, modelId: fallbackId };
}

function emitCodeLog(onEvent: BuildEventHandler | undefined, message: string, detail?: unknown): void {
  onEvent?.({ type: 'log', level: 'info', tag: 'code', message, detail } as never);
  console.log(`[code] ${message}`);
}

function extractToolUses(content: unknown): ToolUseSummary[] {
  if (!Array.isArray(content)) return [];
  const out: ToolUseSummary[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type !== 'tool_use') continue;
    out.push({
      name: String(b.name || ''),
      input: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>,
    });
  }
  return out;
}

function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('\n').trim();
}

function summarizeToolBatch(toolUses: ToolUseSummary[]): string {
  if (!toolUses.length) return 'no tools';
  const counts = new Map<string, number>();
  for (const t of toolUses) {
    counts.set(t.name, (counts.get(t.name) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, n]) => (n > 1 ? `${name}×${n}` : name))
    .join(', ');
}

function toolPath(input: Record<string, unknown>): string | null {
  return toolFilePath(input);
}

function buildWorkspaceCanUseTool(buildDir: string, onEvent?: BuildEventHandler) {
  const root = path.resolve(buildDir);
  return async (toolName: string, input: Record<string, unknown>) => {
    if (!PATH_JAILED_TOOLS.has(toolName)) {
      return { behavior: 'allow' as const };
    }
    const check = validateWorkspaceToolPath(root, toolName, input);
    if (!check.allowed) {
      emitCodeLog(onEvent, `Rejected ${toolName}: ${check.reason}`);
      return {
        behavior: 'deny' as const,
        message: check.reason || `Path must be inside ${root}`,
      };
    }
    if (check.normalizedInput) {
      return { behavior: 'allow' as const, updatedInput: check.normalizedInput };
    }
    return { behavior: 'allow' as const };
  };
}

function toolStepHint(toolUses: ToolUseSummary[]): string {
  const parts: string[] = [];
  for (const t of toolUses.slice(0, 4)) {
    const p = toolPath(t.input);
    if (t.name === 'Write' && p) parts.push(`wrote ${p}`);
    else if (t.name === 'Edit' && p) parts.push(`edited ${p}`);
    else if (t.name === 'Read' && p) parts.push(`read ${p}`);
    else if (t.name === 'Glob' && t.input.pattern) parts.push(`glob ${String(t.input.pattern).slice(0, 40)}`);
    else if (t.name === 'Grep' && t.input.pattern) parts.push(`grep ${String(t.input.pattern).slice(0, 40)}`);
    else parts.push(t.name);
  }
  if (toolUses.length > 4) parts.push(`+${toolUses.length - 4} more`);
  return parts.join(' · ');
}

function usageFromResult(usage: Record<string, unknown> | undefined): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const inputTokens = Number(usage?.input_tokens ?? usage?.inputTokens ?? 0);
  const outputTokens = Number(usage?.output_tokens ?? usage?.outputTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/**
 * Run one CODE invocation via Claude Agent SDK query().
 */
async function runCodeAgentHarness({
  prompt,
  systemPrompt,
  buildDir,
  maxTurns,
  onEvent,
  label = 'code',
}: {
  prompt: string;
  systemPrompt: string;
  buildDir: string;
  maxTurns: number;
  onEvent?: BuildEventHandler;
  label?: string;
}): Promise<HarnessRunResult> {
  assertCodeHarnessConfigured();
  const { query } = await loadSdk();
  const { model, modelId } = resolveClaudeModel();

  const workspaceRoot = path.resolve(buildDir);
  emitCodeLog(
    onEvent,
    `Claude Code harness (${label}, max ${maxTurns} turns) — ${modelId}, cwd=${workspaceRoot} (writes jailed to workspace)`,
  );

  const loopStart = Date.now();
  let stepIndex = 0;
  let hasWritten = false;
  let fullText = '';
  let resultUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let costUsd = 0;
  let numTurns = 0;

  const stream = query({
    prompt,
    options: {
      cwd: workspaceRoot,
      model,
      systemPrompt,
      maxTurns,
      tools: CODE_TOOLS,
      allowedTools: CODE_TOOLS,
      disallowedTools: DISALLOWED_TOOLS,
      canUseTool: buildWorkspaceCanUseTool(workspaceRoot, onEvent),
      permissionMode: 'acceptEdits',
      settingSources: [],
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        CLAUDE_AGENT_SDK_CLIENT_APP: 'devlabs-backend/0.1.0',
      },
    },
  });

  try {
    for await (const message of stream) {
      if (message.type === 'assistant') {
        const content = (message as { message?: { content?: unknown } }).message?.content;
        const toolUses = extractToolUses(content);
        const text = extractAssistantText(content);

        if (toolUses.some((t) => WRITE_TOOLS.has(t.name))) hasWritten = true;

        if (toolUses.length > 0 || text) {
          onEvent?.({ type: 'thinking', step: stepIndex, label: 'Working' } as never);
          const toolsSummary = summarizeToolBatch(toolUses);
          const hint = toolStepHint(toolUses);
          const tokens = '—';
          const costStr = '—';
          const llmMs = Date.now() - loopStart;

          onEvent?.({
            type: 'codeStep',
            step: stepIndex,
            tools: toolsSummary,
            hint,
            ms: llmMs,
            cost: costStr,
            tokens,
            toolCount: toolUses.length,
            summary: text ? text.slice(0, 200) : null,
          } as never);

          const persistLine = toolUses.length
            ? `⚡ Step ${stepIndex + 1} · ${toolsSummary}${hint ? ` — ${hint}` : ''}`
            : `⚡ Step ${stepIndex + 1} · ${text ? text.trim() : 'done'}`;
          emitCodeLog(onEvent, persistLine);
          stepIndex += 1;
        }
        if (text) fullText = text;
      }

      if (message.type === 'result') {
        const result = message as {
          subtype?: string;
          result?: string;
          num_turns?: number;
          total_cost_usd?: number;
          usage?: Record<string, unknown>;
          errors?: string[];
          is_error?: boolean;
        };
        numTurns = result.num_turns ?? stepIndex;
        costUsd = result.total_cost_usd ?? 0;
        resultUsage = usageFromResult(result.usage);
        if (result.subtype === 'success' && result.result) {
          fullText = result.result.trim() || fullText;
        }
        if (result.is_error || (result.subtype && result.subtype !== 'success')) {
          const errMsg = result.errors?.join('; ')
            || `Claude Code harness ended: ${result.subtype || 'error'}`;
          throw new Error(errMsg);
        }
      }
    }
  } finally {
    stream.close?.();
  }

  const totalMs = Date.now() - loopStart;
  const costStr = formatCostUsd(costUsd);
  const tokens = `${resultUsage.inputTokens.toLocaleString()} in / ${resultUsage.outputTokens.toLocaleString()} out`;

  emitCodeLog(
    onEvent,
    `Claude Code harness done: ${numTurns || stepIndex} turn(s), ${(totalMs / 1000).toFixed(1)}s, ${costStr}, ${tokens}`,
  );

  return {
    text: fullText,
    stepCount: numTurns || stepIndex,
    totalMs,
    hasWritten,
    modelId,
    usage: resultUsage,
    costUsd,
  };
}

module.exports = {
  runCodeAgentHarness,
  assertCodeHarnessConfigured,
};
