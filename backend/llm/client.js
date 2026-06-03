'use strict';

// Provider-agnostic LLM facade for the rest of the codebase.
//
// Callers import only:
//   isConfigured, getProvider, getModel
//   streamMessage({ system, messages, maxTokens, onText, agent })
//   completeMessage({ system, messages, maxTokens, agent })
//   embed(text)                                  -> Float[] | null
//
// Internally everything routes through the Vercel AI SDK + the per-agent
// model registry in ./models.js. To pick a different model for an agent,
// set LLM_MODEL_<AGENT> (or LLM_MODEL_DEFAULT for all of them). See
// ./models.js for the resolution order.

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

const DEFAULT_TEXT_AGENT = 'design';
const EMBED_MAX_CHARS = 8000;

function getProvider() {
  // "Provider" is no longer a single global setting — different agents may
  // use different providers. We return the provider of the default text
  // agent for back-compat with callers that just want to surface a single
  // label (Authoring config endpoint, error messages).
  return providerOf(modelIdFor(DEFAULT_TEXT_AGENT));
}

function getModel() {
  const id = modelIdFor(DEFAULT_TEXT_AGENT);
  const colon = id.indexOf(':');
  return colon < 0 ? id : id.slice(colon + 1);
}

function isConfigured() {
  // Every provider in active use across the registry needs its key set.
  return configurationReport().allConfigured;
}

async function streamMessage({
  system,
  messages,
  maxTokens = 4096,
  onText,
  agent = DEFAULT_TEXT_AGENT,
}) {
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
}) {
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

// --- embeddings ----------------------------------------------------------

function isEmbeddingConfigured() {
  const provider = providerOf(modelIdFor('embedding'));
  return isKeyConfiguredFor(provider);
}

function getEmbeddingModel() {
  const id = modelIdFor('embedding');
  const colon = id.indexOf(':');
  return colon < 0 ? id : id.slice(colon + 1);
}

async function embed(text) {
  if (!isEmbeddingConfigured()) return null;
  const input = String(text || '').slice(0, EMBED_MAX_CHARS).trim();
  if (!input) return null;
  try {
    const model = embeddingModel();
    const { embedding } = await aiEmbed({ model, value: input });
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
      // The pgvector column is fixed at 1536 — a different-dim model would
      // silently corrupt nearest-neighbour search. Refuse rather than write.
      console.warn(
        `[llm] embed() got vector of length ${embedding?.length}, expected ${EMBEDDING_DIM} — dropping`,
      );
      return null;
    }
    return embedding;
  } catch (e) {
    // Memory is best-effort; never bubble up.
    console.warn(`[llm] embed() failed: ${e.message}`);
    return null;
  }
}

module.exports = {
  isConfigured,
  getProvider,
  getModel,
  streamMessage,
  completeMessage,
  embed,
  isEmbeddingConfigured,
  getEmbeddingModel,
  listConfiguredModels,
  configurationReport,
  EMBEDDING_DIM,
};
