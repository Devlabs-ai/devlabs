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
}: RunToolLoopOpts): Promise<LlmToolLoopResult> {
  const model = languageModelFor(agent);
  const resolvedModelId = modelIdFor(agent);
  const conversationMessages = [...messages];
  const stepInfos: ToolLoopStepInfo[] = [];
  const usages: Array<ReturnType<typeof normalizeUsage>> = [];
  let fullText = '';
  const loopStart = Date.now();

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    const stepStart = Date.now();
    const result = await generateText({
      model,
      system,
      messages: conversationMessages,
      tools,
      maxOutputTokens: maxTokens,
    });
    const stepMs = Date.now() - stepStart;
    const usage = normalizeUsage(result.usage);
    const costUsd = estimateCostUsd(resolvedModelId, usage);
    usages.push(usage);

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

    const responseMessages = (result as { response?: { messages?: LlmMessage[] } }).response?.messages;
    if (responseMessages?.length) {
      conversationMessages.push(...responseMessages);
    } else {
      break;
    }

    if (!toolCalls.length) break;
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
