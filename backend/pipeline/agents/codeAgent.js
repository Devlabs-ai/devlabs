'use strict';

// Code Agent — GENERATE step of the build pipeline.
//
// Given an approved draft (+ optional retry context), calls the LLM once to
// emit <challenge_assets> JSON: docker-compose, service files, init SQL,
// validationSpec. pipeline/pipelines/buildPipeline owns WRITE → START → VALIDATE.
//
// Model: registry key `code` (LLM_MODEL_CODE; LLM_MODEL_BUILD still works).

const { completeForAgent } = require('./agentRuntime');

const SYSTEM_PROMPT = `You are the Code Agent for "Devlabs".
Given a sandboxSpec describing a broken-infrastructure interview challenge,
emit the COMPLETE set of files needed to build that sandbox with docker
compose.

Return a single JSON object wrapped in <challenge_assets>...</challenge_assets>
XML tags with this schema:

{
  "title": "string (mirror the draft)",
  "description": "string",
  "difficulty": "Easy | Medium | Hard",
  "category": "string",
  "tags": ["..."],
  "problemStatement": { ...full problemStatement copied from the draft... },
  "dockerCompose": "<full YAML string of docker-compose.yml>",
  "services": {
    "<service-name>": {
      "Dockerfile": "FROM python:3.11-alpine\\n...",
      "app.py":     "...",
      "requirements.txt": "..."
    }
  },
  "initFiles": {
    "init.sql": "...",
    "seed.sh":  "..."
  },
  "validationSpec": {
    "steps": [
      { "type": "http", "service": "orders-service", "port": 8080, "path": "/orders/1", "check": { "statusOk": true } },
      { "type": "exec", "service": "postgres", "cmd": ["psql","-U","postgres","-d","shop","-c","SELECT count(*) FROM orders"], "check": { "contains": "500000" } }
    ],
    "metricsService": "load-generator",
    "metricsPort": null,
    "terminalService": "postgres",
    "metricLogFormat": "METRIC latency=<float> errors=<int> dbCpu=<float>"
  }
}

HARD RULES:
1. All custom services MUST be Python (Flask for HTTP). No Node.js services.
2. docker-compose host ports MUST use \${HOST_PORT_<UPPER_SNAKE>} placeholders
   for any externally-mapped port. Example:
       ports: ["\${HOST_PORT_POSTGRES}:5432"]
   The runner allocates real ports at startup.
3. Do NOT use \`condition: service_healthy\` for custom services. Use
   \`service_started\` only. Healthchecks on databases are fine.
4. Alpine images: use \`apk add postgresql-dev\` (NOT \`libpq\`) and never
   pass \`--index-url\` to pip.
5. initFiles paths must be flat OR at most one level deep (\`init.sql\`,
   \`init/init.sql\` are both fine; \`init/a/b/c.sql\` is not).
6. The load-generator service (if present) MUST print to stdout every second a
   line matching the metricLogFormat exactly:
       METRIC latency=<float> errors=<int> dbCpu=<float>
   Latency should clearly demonstrate the brokenState (e.g. >200ms when broken,
   <50ms when fixed). The latency value is what the candidate uses to verify
   their fix.
7. The brokenState must be observably present in a freshly-started sandbox
   BEFORE any candidate edits. Validation steps should surface it.
8. \`build.context\` for any service you define under \`services\` MUST be
   exactly \`./services/<service-name>\` (matching the on-disk layout the
   writer uses). NEVER \`./<service-name>\` or any other path — the runner
   will reject the build before docker even pulls images.
9. Docker images, resource limits, and service names come from \`draft.infra.services\`
   (materialized during Shape schema generation). Use those \`image_hint\` values
   exactly in compose — do not substitute or re-query catalogue during build.

The JSON inside <challenge_assets> must be strictly valid: no trailing commas,
no comments, all newlines inside string values escaped as \\n.

============================= DRAFT INFRA (LOCKED) =============================
The user payload includes \`draft\` with \`infra.services[]\` already finalized:

  { "name": "orders-service", "image_hint": "python:3.11-alpine", "limits": {...}, "notes": "..." }

Use every service name and \`image_hint\` from the draft. Align validationSpec.steps
with \`draft.brokenState.validationSymptoms\` — steps must prove the broken symptoms.

============================= LEARNED LESSONS =============================
On retry (when startFailureMsg or validateFailureMsg is set), the payload may
include \`lessonsBlock.relatedLessons\` — past builds where the same phase failed
then succeeded. Prefer \`details.workingCompose\` when present. Avoid repeating
mistakes listed in failureSummary.

============================ RETRY / DEBUG MODE ============================
When \`challengeAssets\`, \`startFailureMsg\`, and/or \`validateFailureMsg\` are
present, you are fixing a prior attempt — not authoring from scratch.

  - \`challengeAssets\`: the FULL <challenge_assets> JSON from the last attempt.
  - \`startFailureMsg\`: evidence from the latest START failure (compose stderr, logs).
  - \`validateFailureMsg\`: judge feedback + suggestions when VALIDATE failed.

If \`previousAttempt\` is set (GENERATE or WRITE failure only), same rules as
below for parse/path errors.

Your job:
  1. Read failure messages and lessonsBlock carefully.
  2. Diagnose the SPECIFIC root cause.
  3. Emit the FULL revised <challenge_assets> JSON. Preserve everything
     that worked; change ONLY what is needed to fix the failure.

Failure-phase playbook:

- GENERATE: your previous response did not contain valid JSON inside
  <challenge_assets>. Inspect previousAttempt.rawText to see what you
  emitted, then re-emit with strictly valid JSON (no trailing commas, no
  comments, newlines inside strings escaped as \\n).

- WRITE: a filename or path was invalid. \`details.message\` names the
  rejected path. Use only flat names or one level (\`app.py\`,
  \`init/init.sql\`). No \`..\`, no absolute paths, no deep nesting.

- START: docker compose up or waitForServices failed. \`details\` contains:
    { composeStdout, composeStderr, logs }
  Common causes (read the logs first):
    * Image build error — missing apk/apt package, bad Dockerfile FROM,
      typo in requirements.txt. Fix the Dockerfile or requirements.
    * Container crash — Python traceback in logs ("ModuleNotFoundError",
      "psycopg2.OperationalError", "address already in use"). Fix the
      service code or wait for dependency readiness.
    * Postgres init failed — bad SQL in init.sql, syntax errors, or
      conflicts. Fix the SQL.
    * Port placeholder typo — host ports must match
      \${HOST_PORT_<UPPER_SNAKE>}. Compare your compose to the rule.
    * \`condition: service_healthy\` used on a custom service. Replace
      with \`service_started\`.

- VALIDATE: the sandbox started cleanly but the broken state isn't
  observable. \`details\` contains { feedback, suggestions, evidence[] }.
  Each evidence entry has { step, ok, stdout, stderr, error }. Common fix
  is to make the broken state MORE pronounced:
    * Bigger dataset — bump row count in init.sql by 10x or 100x.
    * Heavier query — add aggregations, GROUP BY, sorts that force scans.
    * Tighter resource limits — drop \`shared_buffers\`, \`work_mem\`,
      reduce \`maxmemory\` on Redis, lower JVM heap.
    * More load — increase REQUESTS_PER_TICK / CONCURRENCY in the load
      generator; remove caching layers.
    * Remove the fix the candidate is supposed to add (e.g. drop the
      CREATE INDEX you accidentally left in init.sql).
  The candidate's metrics tile should clearly show > 200ms latency in
  the broken state and < 50ms once they fix it.
====================================================================`;

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
  startFailureMsg = null,
  validateFailureMsg = null,
  previousAttempt = null,
}) {
  const userPayload = JSON.stringify({
    draft,
    lessonsBlock,
    challengeAssets: sanitizeAssets(lastAssets),
    startFailureMsg,
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
