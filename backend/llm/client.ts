'use strict';

// Provider-agnostic LLM facade for the rest of the codebase.
//
// Callers import only:
//   isConfigured, getProvider, getModel
//   streamMessage({ system, messages, maxTokens, onText, agent })
//   completeMessage({ system, messages, maxTokens, agent })
//   runToolLoop({ agent, system, messages, tools, maxSteps, onStep })
//   embed(text)                                  -> Float[] | null

const { streamText, generateText, embed: aiEmbed } = require('ai');
const {
  EMBEDDING_DIM,
  modelIdFor,
  providerOf,
  isKeyConfiguredFor,
  languageModelFor,
  embeddingModel,
  listConfiguredModels,
  configurationReport,
} = require('./models');
const { normalizeUsage } = require('./usage');
const { estimateCostUsd, formatCostUsd } = require('./cost');

const DEFAULT_TEXT_AGENT = 'design';
const EMBED_MAX_CHARS = 8000;

interface LlmMessage {
  role: string;
  content: string;
}

interface StreamMessageOpts {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  onText?: (delta: string) => void;
  agent?: string;
}

interface CompleteMessageOpts {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  agent?: string;
}

interface LlmResult {
  text: string;
  usage: ReturnType<typeof normalizeUsage>;
  modelId: string;
}

interface ToolLoopStepInfo {
  stepIndex: number;
  llmMs: number;
  usage: ReturnType<typeof normalizeUsage>;
  costUsd: number;
  modelId: string;
  toolCalls: Array<{ toolName: string; input?: unknown; toolCallId?: string }>;
  toolResults: Array<{ toolName: string; input?: unknown; output?: unknown }>;
  text?: string;
}

interface RunToolLoopOpts {
  agent?: string;
  system?: string;
  messages: LlmMessage[];
  tools: Record<string, unknown>;
  maxSteps?: number;
  maxTokens?: number;
  onStep?: (step: ToolLoopStepInfo) => void;
  onThinking?: (info: { stepIndex: number; label: string }) => void;
  /** Return false to stop before the next LLM call (after onStep). */
  shouldContinue?: (step: ToolLoopStepInfo) => boolean;
  /** Anthropic: cache system + first user message (ephemeral). */
  promptCache?: boolean;
}

interface LlmToolLoopResult extends LlmResult {
  steps: ToolLoopStepInfo[];
  stepCount: number;
  totalMs: number;
}

function getProvider(): string | null {
  return providerOf(modelIdFor(DEFAULT_TEXT_AGENT));
}

function getModel(): string {
  const id = modelIdFor(DEFAULT_TEXT_AGENT);
  const colon = id.indexOf(':');
  return colon < 0 ? id : id.slice(colon + 1);
}

function isConfigured(): boolean {
  return configurationReport().allConfigured;
}

async function streamMessage({
  system,
  messages,
  maxTokens = 4096,
  onText,
  agent = DEFAULT_TEXT_AGENT,
}: StreamMessageOpts): Promise<LlmResult> {
  const model = languageModelFor(agent);
  const result = streamText({
    model,
    system,
    messages,
    maxOutputTokens: maxTokens,
  });

  let full = '';
  for await (const delta of result.textStream) {
    full += delta;
    if (onText) {
      try { onText(delta); } catch (_e) { /* never let UI callback kill the stream */ }
    }
  }
  const usage = normalizeUsage(await result.usage);
  return { text: full, usage, modelId: modelIdFor(agent) };
}

async function completeMessage({
  system,
  messages,
  maxTokens = 8192,
  agent = DEFAULT_TEXT_AGENT,
}: CompleteMessageOpts): Promise<LlmResult> {
  const model = languageModelFor(agent);
  const result = await generateText({
    model,
    system,
    messages,
    maxOutputTokens: maxTokens,
  });
  return {
    text: result.text,
    usage: normalizeUsage(result.usage),
    modelId: modelIdFor(agent),
  };
}

function aggregateUsage(usages: Array<ReturnType<typeof normalizeUsage> | null | undefined>): ReturnType<typeof normalizeUsage> {
  const out = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  for (const u of usages) {
    if (!u) continue;
    out.inputTokens += u.inputTokens || 0;
    out.outputTokens += u.outputTokens || 0;
    out.totalTokens += u.totalTokens || 0;
  }
  return out;
}

const ANTHROPIC_CACHE_OPTIONS = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };

function buildCacheablePrompt({
  agent,
  system,
  messages,
  promptCache,
}: {
  agent: string;
  system?: string;
  messages: LlmMessage[];
  promptCache?: boolean;
}): { system?: string; messages: unknown[] } {
  const useCache = promptCache && providerOf(modelIdFor(agent)) === 'anthropic' && system;
  if (!useCache) {
    return { system, messages: [...messages] };
  }
  const out: unknown[] = [
    {
      role: 'system',
      content: system,
      providerOptions: ANTHROPIC_CACHE_OPTIONS,
    },
  ];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (i === 0 && m.role === 'user' && typeof m.content === 'string') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: m.content,
            providerOptions: ANTHROPIC_CACHE_OPTIONS,
          },
        ],
      });
    } else {
      out.push(m);
    }
  }
  return { system: undefined, messages: out };
}

function compactToolOutput(toolName: string, output: unknown): unknown {
  if (!output || typeof output !== 'object') return output;
  const o = output as Record<string, unknown>;
  if (o.error) return { ok: false, error: o.error };
  if (toolName === 'write_file' || toolName === 'edit_file') {
    return { ok: true, path: o.path, bytes: o.bytes };
  }
  if (toolName === 'read_file') {
    const content = typeof o.content === 'string' ? o.content : '';
    return {
      ok: true,
      path: o.path,
      chars: content.length,
      preview: content.length > 240 ? `${content.slice(0, 240)}…` : content,
    };
  }
  if (toolName === 'list_files' && Array.isArray(o.files)) {
    return { ok: true, files: o.files.length };
  }
  if (toolName === 'grep' && Array.isArray(o.matches)) {
    return { ok: true, matchCount: o.matches.length, matches: o.matches.slice(0, 8) };
  }
  if (toolName === 'search_code' && Array.isArray(o.hits)) {
    return {
      ok: true,
      hitCount: o.hits.length,
      hits: (o.hits as unknown[]).slice(0, 4),
    };
  }
  return { ok: o.ok === true };
}

function compactToolResultPart(part: Record<string, unknown>): Record<string, unknown> {
  if (part.type !== 'tool-result') return part;
  const toolName = String(part.toolName || '');
  const raw = part.output ?? part.result;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.type === 'json' && 'value' in r) {
      return {
        ...part,
        output: {
          type: 'json',
          value: compactToolOutput(toolName, r.value),
        },
      };
    }
  }
  return { ...part, output: compactToolOutput(toolName, raw) };
}

function compactResponseMessages(messages: unknown[]): unknown[] {
  return messages.map((msg) => {
    if (!msg || typeof msg !== 'object') return msg;
    const m = msg as Record<string, unknown>;
    if (!Array.isArray(m.content)) return msg;
    return {
      ...m,
      content: m.content.map((part) => {
        if (!part || typeof part !== 'object') return part;
        return compactToolResultPart(part as Record<string, unknown>);
      }),
    };
  });
}

const THINKING_LABELS = [
  'Thinking',
  'Planning',
  'Considering',
  'Reviewing',
  'Inspecting',
  'Drafting',
  'Checking',
  'Reasoning',
  'Pondering',
  'Working',
];

function pickThinkingLabel(stepIndex: number): string {
  return THINKING_LABELS[stepIndex % THINKING_LABELS.length];
}

/**
 * Manual multi-step tool loop — one LLM generation per step for real-time logging.
 */
async function runToolLoop({
  agent = DEFAULT_TEXT_AGENT,
  system,
  messages,
  tools,
  maxSteps = 20,
  maxTokens = 16384,
  onStep,
  onThinking,
  shouldContinue,
  promptCache = false,
}: RunToolLoopOpts): Promise<LlmToolLoopResult> {
  const model = languageModelFor(agent);
  const resolvedModelId = modelIdFor(agent);
  const prompt = buildCacheablePrompt({ agent, system, messages, promptCache });
  const conversationMessages = [...prompt.messages] as LlmMessage[];
  const stepInfos: ToolLoopStepInfo[] = [];
  const usages: Array<ReturnType<typeof normalizeUsage>> = [];
  let fullText = '';
  const loopStart = Date.now();

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    onThinking?.({ stepIndex, label: pickThinkingLabel(stepIndex) });
    const stepStart = Date.now();
    const result = await generateText({
      model,
      system: prompt.system,
      messages: conversationMessages,
      tools,
      maxOutputTokens: maxTokens,
    });
    const stepMs = Date.now() - stepStart;
    const usage = normalizeUsage(result.usage);
    const costUsd = estimateCostUsd(resolvedModelId, usage);
    usages.push(usage);

    const anthropicMeta = (result as { providerMetadata?: { anthropic?: Record<string, unknown> } }).providerMetadata?.anthropic;
    if (anthropicMeta && (anthropicMeta.cacheReadInputTokens || anthropicMeta.cacheCreationInputTokens)) {
      console.log(
        `[llm] cache step ${stepIndex + 1}: read=${anthropicMeta.cacheReadInputTokens || 0} created=${anthropicMeta.cacheCreationInputTokens || 0}`,
      );
    }

    const toolCalls = (result.toolCalls || []).map((tc: Record<string, unknown>) => ({
      toolName: String(tc.toolName || ''),
      input: tc.input,
      toolCallId: tc.toolCallId as string | undefined,
    }));
    const toolResults = (result.toolResults || []).map((tr: Record<string, unknown>) => ({
      toolName: String(tr.toolName || ''),
      input: tr.input,
      output: tr.output,
    }));

    const stepInfo: ToolLoopStepInfo = {
      stepIndex,
      llmMs: stepMs,
      usage,
      costUsd,
      modelId: resolvedModelId,
      toolCalls,
      toolResults,
      text: result.text || undefined,
    };
    stepInfos.push(stepInfo);
    onStep?.(stepInfo);

    if (result.text) fullText = result.text;

    const responseMessages = (result as { response?: { messages?: unknown[] } }).response?.messages;
    if (responseMessages?.length) {
      conversationMessages.push(...compactResponseMessages(responseMessages) as LlmMessage[]);
    } else {
      break;
    }

    if (!toolCalls.length) break;
    if (shouldContinue && !shouldContinue(stepInfo)) break;
  }

  return {
    text: fullText,
    usage: aggregateUsage(usages),
    modelId: resolvedModelId,
    steps: stepInfos,
    stepCount: stepInfos.length,
    totalMs: Date.now() - loopStart,
  };
}

// --- embeddings ----------------------------------------------------------

function isEmbeddingConfigured(): boolean {
  const provider = providerOf(modelIdFor('embedding'));
  return isKeyConfiguredFor(provider);
}

function getEmbeddingModel(): string {
  const id = modelIdFor('embedding');
  const colon = id.indexOf(':');
  return colon < 0 ? id : id.slice(colon + 1);
}

async function embed(text: unknown): Promise<number[] | null> {
  if (!isEmbeddingConfigured()) return null;
  const input = String(text || '').slice(0, EMBED_MAX_CHARS).trim();
  if (!input) return null;
  try {
    const model = embeddingModel();
    const { embedding } = await aiEmbed({ model, value: input });
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
      console.warn(
        `[llm] embed() got vector of length ${(embedding as unknown[])?.length}, expected ${EMBEDDING_DIM} — dropping`,
      );
      return null;
    }
    return embedding;
  } catch (e: unknown) {
    console.warn(`[llm] embed() failed: ${(e as Error).message}`);
    return null;
  }
}

module.exports = {
  isConfigured,
  getProvider,
  getModel,
  streamMessage,
  completeMessage,
  runToolLoop,
  embed,
  isEmbeddingConfigured,
  getEmbeddingModel,
  listConfiguredModels,
  configurationReport,
  EMBEDDING_DIM,
};
