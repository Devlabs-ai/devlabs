'use strict';

// Per-agent LLM model registry.
//
// Each agent that calls into backend/llm/client.js declares a stable key
// ('design', 'schema', 'code', 'validation', 'embedding'). The model
// it actually uses is resolved here from env vars, in this precedence:
//
//   1. LLM_MODEL_<AGENT>          (per-agent override, e.g. LLM_MODEL_SCHEMA)
//   2. LLM_MODEL_DEFAULT          (fallback for all text agents)
//   3. legacy OPENAI_MODEL/ANTHROPIC_MODEL + LLM_PROVIDER hint
//   4. baked-in DEFAULTS below
//
// Embedding follows its own track: LLM_EMBEDDING_MODEL > baked default.
//
// Model id format: "<provider>:<model>", e.g. "openai:gpt-4o",
// "anthropic:claude-haiku-4-5". For the openai provider we route
// through the Chat Completions API (not Responses) so OpenAI-compatible
// gateways like OpenRouter / LiteLLM / Azure can be used by setting
// OPENAI_BASE_URL — the Responses API isn't widely supported by those.

const { createOpenAI } = require('@ai-sdk/openai');
const { createAnthropic } = require('@ai-sdk/anthropic');

const DEFAULTS: Record<string, string> = {
  design:     'openai:gpt-4.5',
  schema:     'openai:gpt-4o',
  code:       'anthropic:claude-haiku-4-5',
  validation: 'openai:gpt-4o-mini',
  embedding:  'openai:text-embedding-3-small',
  // Spark authoring (Claude Agent SDK for code-gen stages)
  spark_design:     'anthropic:claude-haiku-4-5',
  spark_data:       'anthropic:claude-haiku-4-5',
  spark_code:       'anthropic:claude-haiku-4-5',
  spark_validation: 'openai:gpt-4o-mini',
  spark_eval_repair: 'anthropic:claude-haiku-4-5',
};

/** Default Anthropic model for all text agents (cost-efficient). */
const ANTHROPIC_DEFAULT = 'anthropic:claude-haiku-4-5';

/** Legacy Sonnet 4.6 IDs map to Haiku 4.5 automatically. */
const SONNET_46_ALIASES = new Set([
  'claude-sonnet-4-6',
]);

const PIPELINE_AGENTS = new Set([
  'schema',
  'code',
  'validation',
  'spark_data',
  'spark_code',
  'spark_eval_repair',
]);

const TEXT_AGENTS: string[] = [
  'design',
  'schema',
  'code',
  'validation',
  'spark_design',
  'spark_data',
  'spark_code',
  'spark_validation',
  'spark_eval_repair',
];

/** @deprecated use `code` — LLM_MODEL_BUILD still honored in modelIdFor */
const BUILD_AGENT_ALIAS = 'build';
const EMBEDDING_DIM = 1536; // openai text-embedding-3-small dim; pgvector schema is fixed at this

function normalizeAnthropicModelId(modelId: string): string {
  const id = String(modelId || '');
  if (!id.startsWith('anthropic:')) return id;
  const model = id.slice('anthropic:'.length);
  if (SONNET_46_ALIASES.has(model)) return ANTHROPIC_DEFAULT;
  return id;
}

function legacyDefaultModelId(): string | null {
  // Back-compat for the previous LLM_PROVIDER + provider-specific env layout.
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (provider === 'anthropic' && process.env.ANTHROPIC_MODEL) {
    return `anthropic:${process.env.ANTHROPIC_MODEL}`;
  }
  if (provider === 'openai' && process.env.OPENAI_MODEL) {
    return `openai:${process.env.OPENAI_MODEL}`;
  }
  return null;
}

function usesAnthropicTextModels(): boolean {
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (provider === 'anthropic') return true;
  if (process.env.LLM_MODEL_DEFAULT?.startsWith('anthropic:')) return true;
  if (process.env.ANTHROPIC_MODEL) return true;
  for (const agent of TEXT_AGENTS) {
    const id = process.env[`LLM_MODEL_${agent.toUpperCase()}`];
    if (id?.startsWith('anthropic:')) return true;
  }
  if (process.env.LLM_MODEL_BUILD?.startsWith('anthropic:')) return true;
  return false;
}

function anthropicDefaultFor(_agent: string): string | null {
  if (!usesAnthropicTextModels()) return null;
  if (process.env.ANTHROPIC_MODEL) {
    return normalizeAnthropicModelId(`anthropic:${process.env.ANTHROPIC_MODEL}`);
  }
  return ANTHROPIC_DEFAULT;
}

function modelIdFor(agent: string): string {
  if (agent === 'embedding') {
    return process.env.LLM_EMBEDDING_MODEL || DEFAULTS.embedding;
  }
  const key = agent === BUILD_AGENT_ALIAS ? 'code' : agent;
  if (key === 'code' && process.env.LLM_MODEL_BUILD) {
    return normalizeAnthropicModelId(process.env.LLM_MODEL_BUILD);
  }
  const specific = process.env[`LLM_MODEL_${key.toUpperCase()}`];
  if (specific) return normalizeAnthropicModelId(specific);
  const anthropicDefault = anthropicDefaultFor(key);
  if (anthropicDefault && PIPELINE_AGENTS.has(key)) return anthropicDefault;
  if (process.env.LLM_MODEL_DEFAULT) {
    return normalizeAnthropicModelId(process.env.LLM_MODEL_DEFAULT);
  }
  if (anthropicDefault) return anthropicDefault;
  const legacy = legacyDefaultModelId();
  if (legacy) return normalizeAnthropicModelId(legacy);
  return DEFAULTS[key] || DEFAULTS.design;
}

function splitId(modelId: string): { provider: string; model: string } {
  const idx = String(modelId).indexOf(':');
  if (idx < 1) throw new Error(`invalid model id "${modelId}" — expected "<provider>:<model>"`);
  return { provider: modelId.slice(0, idx), model: modelId.slice(idx + 1) };
}

function providerOf(modelId: string): string | null {
  try { return splitId(modelId).provider; } catch (_e) { return null; }
}

function isKeyConfiguredFor(provider: string | null): boolean {
  if (provider === 'openai') return !!process.env.OPENAI_API_KEY;
  if (provider === 'anthropic') return !!process.env.ANTHROPIC_API_KEY;
  return false;
}

// Lazy provider construction so an unconfigured provider doesn't throw at
// boot. The AI SDK doesn't error until first call anyway, but lazy keeps
// our intent explicit (and lets us add more providers without paying boot
// cost for unused ones).
const _providers = new Map<string, unknown>();
function getProviderClient(name: string): unknown {
  if (_providers.has(name)) return _providers.get(name);
  let client: unknown;
  if (name === 'openai') {
    client = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  } else if (name === 'anthropic') {
    client = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    });
  } else {
    throw new Error(`unknown LLM provider: "${name}". Supported: openai, anthropic`);
  }
  _providers.set(name, client);
  return client;
}

function languageModelFor(agent: string): unknown {
  const { provider, model } = splitId(modelIdFor(agent));
  const client = getProviderClient(provider);
  // OpenAI: pick Chat Completions explicitly for max compat with
  // OpenAI-compatible gateways (OpenRouter, LiteLLM, Azure).
  if (provider === 'openai') return (client as any).chat(model);
  return (client as (m: string) => unknown)(model);
}

function embeddingModel(): unknown {
  const { provider, model } = splitId(modelIdFor('embedding'));
  const client = getProviderClient(provider) as any;
  if (typeof client.embedding !== 'function') {
    throw new Error(`provider "${provider}" does not expose an embedding model`);
  }
  return client.embedding(model);
}

function listConfiguredModels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const agent of TEXT_AGENTS) out[agent] = modelIdFor(agent);
  out.embedding = modelIdFor('embedding');
  return out;
}

// "configured" answer used by /api/problems/config + agent guards. Each
// distinct provider used across the registry needs its API key set. We
// surface a per-provider map so the UI can show specifically which key
// is missing.
function configurationReport(): { models: Record<string, string>; providers: Record<string, boolean>; allConfigured: boolean } {
  const models = listConfiguredModels();
  const providers = new Set<string>();
  for (const id of Object.values(models)) {
    const p = providerOf(id);
    if (p) providers.add(p);
  }
  const providerStatus: Record<string, boolean> = {};
  for (const p of providers) providerStatus[p] = isKeyConfiguredFor(p);
  const allConfigured = Object.values(providerStatus).every(Boolean);
  return { models, providers: providerStatus, allConfigured };
}

module.exports = {
  DEFAULTS,
  TEXT_AGENTS,
  EMBEDDING_DIM,
  modelIdFor,
  splitId,
  providerOf,
  isKeyConfiguredFor,
  languageModelFor,
  embeddingModel,
  listConfiguredModels,
  configurationReport,
};
