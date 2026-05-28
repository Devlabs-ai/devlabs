'use strict';

// Code Agent — GENERATE step of the build pipeline.
//
// Given an approved draft (+ optional retry context), calls the LLM once to
// emit <challenge_assets> JSON: docker-compose, service files, init SQL,
// validationSpec. pipeline/pipelines/buildPipeline owns WRITE → SPIN → VALIDATE.
//
// Model: registry key `code` (LLM_MODEL_CODE; LLM_MODEL_BUILD still works).

const { completeForAgent } = require('../helpers/agentRuntime');
const { SYSTEM_PROMPT } = require('../prompts/codeAgent.prompt');

function cap(s, max) {
  if (!s) return s;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated ${str.length - max} chars]`;
}

function extractAssets(text) {
  const m = /<challenge_assets>([\s\S]*?)<\/challenge_assets>/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch (e) {
    const err = new Error(`failed to parse <challenge_assets> JSON: ${e.message}`);
    err.raw = m[1];
    throw err;
  }
}

function sanitizePreviousAttempt(prev) {
  if (!prev) return null;
  const out = {
    phase: prev.phase,
    message: prev.message,
    details: null,
    artifacts: null,
    rawText: null,
  };
  if (prev.artifacts) {
    const safe = JSON.parse(JSON.stringify(prev.artifacts));
    if (typeof safe.dockerCompose === 'string') safe.dockerCompose = cap(safe.dockerCompose, 6000);
    if (safe.services) {
      for (const [, files] of Object.entries(safe.services)) {
        for (const fname of Object.keys(files || {})) {
          if (typeof files[fname] === 'string') files[fname] = cap(files[fname], 4000);
        }
      }
    }
    if (safe.initFiles) {
      for (const fname of Object.keys(safe.initFiles)) {
        if (typeof safe.initFiles[fname] === 'string') {
          safe.initFiles[fname] = cap(safe.initFiles[fname], 4000);
        }
      }
    }
    out.artifacts = safe;
  } else if (prev.rawText) {
    out.rawText = cap(prev.rawText, 6000);
  }
  if (prev.details) {
    const d = prev.details;
    out.details = {};
    if (d.composeStdout) out.details.composeStdout = cap(d.composeStdout, 2000);
    if (d.composeStderr) out.details.composeStderr = cap(d.composeStderr, 2000);
    if (d.logs) out.details.logs = cap(d.logs, 4000);
    if (d.feedback) out.details.feedback = d.feedback;
    if (Array.isArray(d.suggestions)) out.details.suggestions = d.suggestions;
    if (Array.isArray(d.evidence)) {
      out.details.evidence = d.evidence.map((ev) => ({
        step: ev.step,
        ok: ev.ok,
        statusCode: ev.statusCode,
        error: ev.error,
        stdout: cap(ev.stdout, 2000),
        stderr: cap(ev.stderr, 1000),
      }));
    }
  }
  return out;
}

function sanitizeAssets(assets) {
  if (!assets) return null;
  return sanitizePreviousAttempt({
    phase: 'RETRY',
    message: '',
    artifacts: assets,
    details: null,
  }).artifacts;
}

function summariseAssets(assets) {
  return {
    title: assets?.title,
    services: Object.keys(assets?.services || {}),
    initFiles: Object.keys(assets?.initFiles || {}),
    composeBytes: (assets?.dockerCompose || '').length,
    hasValidationSpec: !!assets?.validationSpec,
  };
}

/**
 * LLM GENERATE step: draft + retry context → challenge_assets object.
 * @returns {{ rawText: string, assets: object }}
 */
async function generateChallengeAssets({
  draft,
  lessonsBlock = { relatedLessons: [] },
  lastAssets = null,
  spinFailureMsg = null,
  validateFailureMsg = null,
  previousAttempt = null,
}) {
  const userPayload = JSON.stringify({
    draft,
    lessonsBlock,
    challengeAssets: sanitizeAssets(lastAssets),
    spinFailureMsg,
    validateFailureMsg,
    previousAttempt: sanitizePreviousAttempt(previousAttempt),
  }, null, 2);

  const rawText = await completeForAgent({
    agent: 'code',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPayload }],
    maxTokens: 16384,
  });

  const assets = extractAssets(rawText);
  if (!assets) {
    const err = new Error('LLM response did not contain <challenge_assets> JSON');
    err.rawText = rawText;
    throw err;
  }
  return { rawText, assets };
}

module.exports = {
  SYSTEM_PROMPT,
  generateChallengeAssets,
  extractAssets,
  summariseAssets,
};
