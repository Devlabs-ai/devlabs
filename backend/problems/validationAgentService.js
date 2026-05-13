'use strict';

// Validation Agent — runs the mechanical validationSpec.steps against a
// running build and then asks Claude to judge the collected evidence against
// the original `sandboxSpec` intent.
//
// Two kinds of steps are supported (matches the spec):
//   { type: 'http', service, port, path, check }
//   { type: 'exec', service, cmd: [...], check }
//
// `check` is optional structured guidance (e.g. `{ contains: "..." }`,
// `{ statusOk: true }`). Each step's raw result is captured in `evidence[]`.
//
// The LLM is asked: given the broken-state we set up, does this evidence
// prove the sandbox actually reproduces it? Returns `{ passed, feedback,
// suggestions }`.

const composeManager = require('../sandbox/composeManager');
const llm = require('../llm/client');

const SYSTEM_PROMPT = `You are the Build Validation Judge for a Docker-based
interview platform. You will receive:

1. The intended brokenState (a string describing what should be wrong with
   the sandbox).
2. The validationApproach (how a candidate's fix would be detected).
3. Evidence collected by running validationSpec.steps against the freshly-built
   sandbox (each step has type, target, command/path, and raw output).

Your job is to decide if the sandbox correctly reproduces the brokenState.
Return ONLY a JSON object inside <validation_result>...</validation_result>:

<validation_result>
{
  "passed": true|false,
  "feedback": "1-2 sentence summary",
  "suggestions": ["concrete change to docker-compose / service code / init.sql"]
}
</validation_result>

PASS means: the broken state is actually present in the running sandbox. The
sandbox is REPRODUCIBLE — running validationSpec.steps before any candidate
edits surfaces the problem.

FAIL means: the brokenState is not visible (e.g. queries are fast when they
should be slow, the service is healthy when it should be flapping). Suggest
concrete changes the next build iteration should make.`;

async function runStep(buildDir, portMap, step) {
  const out = { step, ok: false, stdout: '', stderr: '', error: null, statusCode: null };

  try {
    if (step.type === 'http') {
      const portField = `HOST_PORT_${(step.service || '').toUpperCase().replace(/-/g, '_')}`;
      const externalPort = portMap[portField] || step.port;
      const url = `http://localhost:${externalPort}${step.path || '/'}`;
      const res = await fetch(url, { method: step.method || 'GET' }).catch((e) => ({
        ok: false,
        status: 0,
        text: async () => `fetch failed: ${e.message}`,
      }));
      out.statusCode = res.status || 0;
      out.stdout = await res.text().catch(() => '');
      out.ok = !!res.ok;
    } else if (step.type === 'exec') {
      const cmd = Array.isArray(step.cmd) ? step.cmd : [step.cmd];
      const { stdout, stderr } = await composeManager.exec(buildDir, step.service, cmd, { portMap });
      out.stdout = stdout;
      out.stderr = stderr;
      out.ok = true;
    } else {
      out.error = `unknown step type "${step.type}"`;
    }
  } catch (e) {
    out.error = e.message;
    out.stderr = e.stderr || '';
    out.stdout = e.stdout || '';
  }

  // simple synchronous `check` evaluator
  if (out.ok && step.check) {
    if (step.check.contains && !`${out.stdout}\n${out.stderr}`.includes(step.check.contains)) {
      out.ok = false;
      out.error = `expected output to contain "${step.check.contains}"`;
    }
    if (step.check.statusOk && (!out.statusCode || out.statusCode >= 400)) {
      out.ok = false;
      out.error = `expected HTTP 2xx/3xx, got ${out.statusCode}`;
    }
  }

  return out;
}

function extractResult(text) {
  const m = /<validation_result>([\s\S]*?)<\/validation_result>/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch (_e) {
    return null;
  }
}

async function validate({ buildDir, portMap, sandboxSpec, validationSpec, onLog }) {
  const log = (msg) => { if (onLog) onLog(msg); };

  const steps = (validationSpec && validationSpec.steps) || [];
  const evidence = [];

  if (steps.length === 0) {
    log('[validate] no validation steps defined — relying on LLM judgment alone');
  }

  for (const step of steps) {
    log(`[validate] step: ${step.type} ${step.service || ''} ${step.path || (step.cmd || []).join(' ')}`);
    // eslint-disable-next-line no-await-in-loop
    const result = await runStep(buildDir, portMap, step);
    evidence.push(result);
    const summary = result.error
      ? `error: ${result.error}`
      : result.ok ? 'ok' : 'check failed';
    log(`[validate]   -> ${summary}`);
  }

  // If the LLM isn't configured we fall back to a purely mechanical pass:
  // all steps "ok" → passed. This keeps the pipeline usable for hand-tuned
  // challenges even without an Anthropic key.
  if (!llm.isConfigured()) {
    const allOk = evidence.length > 0 && evidence.every((e) => e.ok);
    const provider = llm.getProvider();
    const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    return {
      passed: allOk,
      feedback: allOk
        ? `Mechanical validation passed (LLM judge skipped — no ${keyName}).`
        : `Mechanical validation failed. Configure ${keyName} for richer feedback.`,
      suggestions: [],
      evidence,
    };
  }

  const userMessage = JSON.stringify({
    brokenState: sandboxSpec?.brokenState || '(not specified)',
    validationApproach: sandboxSpec?.validationApproach || '(not specified)',
    evidence: evidence.map((e) => ({
      step: e.step,
      ok: e.ok,
      statusCode: e.statusCode,
      stdout: (e.stdout || '').slice(0, 4000),
      stderr: (e.stderr || '').slice(0, 1000),
      error: e.error,
    })),
  }, null, 2);

  log('[validate] asking LLM judge to evaluate evidence...');
  const text = await llm.completeMessage({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 1024,
  });

  const parsed = extractResult(text) || {
    passed: evidence.every((e) => e.ok),
    feedback: 'Could not parse LLM judge output; fell back to mechanical check.',
    suggestions: [],
  };
  parsed.evidence = evidence;
  return parsed;
}

module.exports = { validate, runStep, SYSTEM_PROMPT };
