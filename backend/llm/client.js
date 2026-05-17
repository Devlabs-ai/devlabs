'use strict';

// Provider-agnostic LLM client. The rest of the codebase only imports
// `isConfigured`, `getModel`, `streamMessage`, `completeMessage` from here —
// it never touches the underlying SDK. This lets you flip between
// Anthropic and OpenAI by setting:
//
//   LLM_PROVIDER=anthropic        (default)
//     ANTHROPIC_API_KEY=sk-ant-...
//     ANTHROPIC_BASE_URL=         (optional proxy)
//     ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
//
//   LLM_PROVIDER=openai
//     OPENAI_API_KEY=sk-...
//     OPENAI_BASE_URL=            (optional proxy, e.g. LiteLLM / OpenRouter)
//     OPENAI_MODEL=gpt-4o
//
// Both providers expose:
//   streamMessage({ system, messages, onText, maxTokens }) -> fullText
//   completeMessage({ system, messages, maxTokens })       -> fullText
//
// messages: [{ role: 'user' | 'assistant', content: string }, ...]

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

function getProvider() {
  const p = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();
  return p === 'openai' ? 'openai' : 'anthropic';
}

function isConfigured() {
  if (getProvider() === 'openai') return !!process.env.OPENAI_API_KEY;
  return !!process.env.ANTHROPIC_API_KEY;
}

function getModel() {
  if (getProvider() === 'openai') return process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  return process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
}

// --- clients (lazy) ------------------------------------------------------

let _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY is not set');
    e.code = 'LLM_NOT_CONFIGURED';
    throw e;
  }
  const opts = { apiKey: process.env.ANTHROPIC_API_KEY };
  if (process.env.ANTHROPIC_BASE_URL) opts.baseURL = process.env.ANTHROPIC_BASE_URL;
  _anthropic = new Anthropic(opts);
  return _anthropic;
}

let _openai = null;
function getOpenAI() {
  if (_openai) return _openai;
  if (!process.env.OPENAI_API_KEY) {
    const e = new Error('OPENAI_API_KEY is not set');
    e.code = 'LLM_NOT_CONFIGURED';
    throw e;
  }
  const opts = { apiKey: process.env.OPENAI_API_KEY };
  if (process.env.OPENAI_BASE_URL) opts.baseURL = process.env.OPENAI_BASE_URL;
  _openai = new OpenAI(opts);
  return _openai;
}

// --- streaming -----------------------------------------------------------

async function streamWithAnthropic({ system, messages, maxTokens, onText }) {
  const client = getAnthropic();
  const stream = await client.messages.stream({
    model: getModel(),
    max_tokens: maxTokens,
    system,
    messages,
  });

  let full = '';
  stream.on('text', (delta) => {
    full += delta;
    if (onText) {
      try { onText(delta); } catch (_e) { /* don't kill the stream */ }
    }
  });

  await stream.finalMessage();
  return full;
}

async function streamWithOpenAI({ system, messages, maxTokens, onText }) {
  const client = getOpenAI();
  const merged = [];
  if (system) merged.push({ role: 'system', content: system });
  for (const m of messages || []) merged.push({ role: m.role, content: m.content });

  const stream = await client.chat.completions.create({
    model: getModel(),
    max_tokens: maxTokens,
    stream: true,
    messages: merged,
  });

  let full = '';
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (!delta) continue;
    full += delta;
    if (onText) {
      try { onText(delta); } catch (_e) { /* noop */ }
    }
  }
  return full;
}

async function streamMessage({ system, messages, maxTokens = 4096, onText }) {
  if (getProvider() === 'openai') {
    return streamWithOpenAI({ system, messages, maxTokens, onText });
  }
  return streamWithAnthropic({ system, messages, maxTokens, onText });
}

// --- one-shot ------------------------------------------------------------

async function completeWithAnthropic({ system, messages, maxTokens }) {
  const client = getAnthropic();
  const resp = await client.messages.create({
    model: getModel(),
    max_tokens: maxTokens,
    system,
    messages,
  });
  return (resp.content || [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

async function completeWithOpenAI({ system, messages, maxTokens }) {
  const client = getOpenAI();
  const merged = [];
  if (system) merged.push({ role: 'system', content: system });
  for (const m of messages || []) merged.push({ role: m.role, content: m.content });

  const resp = await client.chat.completions.create({
    model: getModel(),
    max_tokens: maxTokens,
    messages: merged,
  });
  return resp.choices?.[0]?.message?.content || '';
}

async function completeMessage({ system, messages, maxTokens = 8192 }) {
  if (getProvider() === 'openai') {
    return completeWithOpenAI({ system, messages, maxTokens });
  }
  return completeWithAnthropic({ system, messages, maxTokens });
}

// --- embeddings ----------------------------------------------------------

// Embeddings always use OpenAI's text-embedding-3-small. Anthropic does not
// have a first-party embeddings API, so even when LLM_PROVIDER=anthropic
// we route embeddings through OpenAI if OPENAI_API_KEY is set. Without an
// OpenAI key, `embed()` returns null and the caller treats memory as cold.
function getEmbeddingModel() {
  return process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_OPENAI_EMBEDDING_MODEL;
}

function isEmbeddingConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

// Hard cap on the input text we send to the embedding endpoint. The model
// itself accepts ~8K tokens, but we don't want any single failure/exemplar
// dragging more text into one vector than is useful.
const EMBED_MAX_CHARS = 8000;

async function embed(text) {
  if (!isEmbeddingConfigured()) return null;
  const input = String(text || '').slice(0, EMBED_MAX_CHARS).trim();
  if (!input) return null;
  try {
    const client = getOpenAI();
    const resp = await client.embeddings.create({
      model: getEmbeddingModel(),
      input,
    });
    const vec = resp.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) return null;
    return vec;
  } catch (e) {
    // Never let an embedding failure bubble up; memory is best-effort.
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
  EMBEDDING_DIM,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
};
