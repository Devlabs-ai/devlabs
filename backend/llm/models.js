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
// "anthropic:claude-sonnet-4-5-20250929". For the openai provider we route
// through the Chat Completions API (not Responses) so OpenAI-compatible
// gateways like OpenRouter / LiteLLM / Azure can be used by setting
// OPENAI_BASE_URL — the Responses API isn't widely supported by those.

const { createOpenAI } = require('@ai-sdk/openai');
const { createAnthropic } = require('@ai-sdk/anthropic');

const DEFAULT_TEXT = 'openai:gpt-4o';
const DEFAULT_VALIDATION = 'openai:gpt-4o-mini';
const DEFAULT_EMBEDDING = 'openai:text-embedding-3-small';

const DEFAULTS = {
  design:     DEFAULT_TEXT,
  schema:     DEFAULT_TEXT,
  code:       DEFAULT_TEXT,
  validation: DEFAULT_VALIDATION,
  embedding:  DEFAULT_EMBEDDING,
};

const TEXT_AGENTS = ['design', 'schema', 'code', 'validation'];

/** @deprecated use `code` — LLM_MODEL_BUILD still honored in modelIdFor */
const BUILD_AGENT_ALIAS = 'build';
const EMBEDDING_DIM = 1536; // openai text-embedding-3-small dim; pgvector schema is fixed at this

function legacyDefaultModelId() {
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

function modelIdFor(agent) {
  if (agent === 'embedding') {
    return process.env.LLM_EMBEDDING_MODEL || DEFAULTS.embedding;
  }
  const key = agent === BUILD_AGENT_ALIAS ? 'code' : agent;
  if (key === 'code' && process.env.LLM_MODEL_BUILD) {
    return process.env.LLM_MODEL_BUILD;
  }
  const specific = process.env[`LLM_MODEL_${key.toUpperCase()}`];
  if (specific) return specific;
  if (process.env.LLM_MODEL_DEFAULT) return process.env.LLM_MODEL_DEFAULT;
  const legacy = legacyDefaultModelId();
  if (legacy) return legacy;
  return DEFAULTS[key] || DEFAULT_TEXT;
}

function splitId(modelId) {
  const idx = String(modelId).indexOf(':');
  if (idx < 1) throw new Error(`invalid model id "${modelId}" — expected "<provider>:<model>"`);
  return { provider: modelId.slice(0, idx), model: modelId.slice(idx + 1) };
}

function providerOf(modelId) {
  try { return splitId(modelId).provider; } catch (_e) { return null; }
}

function isKeyConfiguredFor(provider) {
  if (provider === 'openai') return !!process.env.OPENAI_API_KEY;
  if (provider === 'anthropic') return !!process.env.ANTHROPIC_API_KEY;
  return false;
}

// Lazy provider construction so an unconfigured provider doesn't throw at
// boot. The AI SDK doesn't error until first call anyway, but lazy keeps
// our intent explicit (and lets us add more providers without paying boot
// cost for unused ones).
const _providers = new Map();
function getProviderClient(name) {
  if (_providers.has(name)) return _providers.get(name);
  let client;
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

function languageModelFor(agent) {
  const { provider, model } = splitId(modelIdFor(agent));
  const client = getProviderClient(provider);
  // OpenAI: pick Chat Completions explicitly for max compat with
  // OpenAI-compatible gateways (OpenRouter, LiteLLM, Azure, vLLM, Ollama).
  if (provider === 'openai') return client.chat(model);
  return client(model);
}

function embeddingModel() {
  const { provider, model } = splitId(modelIdFor('embedding'));
  const client = getProviderClient(provider);
  if (typeof client.embedding !== 'function') {
    throw new Error(`provider "${provider}" does not expose an embedding model`);
  }
  return client.embedding(model);
}

function listConfiguredModels() {
  const out = {};
  for (const agent of TEXT_AGENTS) out[agent] = modelIdFor(agent);
  out.embedding = modelIdFor('embedding');
  return out;
}

// "configured" answer used by /api/problems/config + agent guards. Each
// distinct provider used across the registry needs its API key set. We
// surface a per-provider map so the UI can show specifically which key
// is missing.
function configurationReport() {
  const models = listConfiguredModels();
  const providers = new Set();
  for (const id of Object.values(models)) {
    const p = providerOf(id);
    if (p) providers.add(p);
  }
  const providerStatus = {};
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
