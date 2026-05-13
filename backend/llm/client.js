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

module.exports = {
  isConfigured,
  getProvider,
  getModel,
  streamMessage,
  completeMessage,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
};
