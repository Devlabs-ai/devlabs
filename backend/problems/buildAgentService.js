'use strict';

// Build Agent — runs up to MAX_ITERATIONS attempts of
// GENERATE → WRITE → START → VALIDATE. Each attempt is fully self-contained:
// if validation fails, the compose stack is torn down and the failure context
// is folded into the next GENERATE call so the LLM can correct itself.
//
// The caller drives the loop via `runBuildLoop({ draft, draftSessionId,
// onEvent, ... })`. `onEvent` receives SSE-shaped events:
//   { type: 'log',       message }
//   { type: 'phase',     phase: 'GENERATE|WRITE|START|VALIDATE', attempt, total }
//   { type: 'buildDir',  buildDir }
//   { type: 'validation', result: { passed, feedback, ... } }
//   { type: 'done',      buildSessionId, builtChallenge, buildValidation,
//                        terminalWsUrl, metricsWsUrl }
//   { type: 'error',     message }

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const llm = require('../llm/client');
const composeManager = require('../sandbox/composeManager');
const portAllocator = require('../sandbox/portAllocator');
const validationAgent = require('./validationAgentService');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILDS_ROOT = path.join(ROOT, 'sandbox', 'builds');

const MAX_ITERATIONS = 5;

const GENERATE_SYSTEM_PROMPT = `You are the Build Agent for "System Escape Room".
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

The JSON inside <challenge_assets> must be strictly valid: no trailing commas,
no comments, all newlines inside string values escaped as \\n.

============================ DEBUG MODE ============================
If the user message includes a non-null \`previousAttempt\`, you are NOT
authoring from scratch — you are DEBUGGING the previous attempt. The
previousAttempt object contains:

  {
    "artifacts": { ... }      // the FULL <challenge_assets> JSON you emitted
                              // last time. null if GENERATE itself failed.
    "rawText":   "..."        // raw LLM response, only present when artifacts
                              // could not be parsed.
    "phase":     "GENERATE | WRITE | START | VALIDATE",  // where it failed
    "message":   "...",       // short error string
    "details":   { ... }      // phase-specific evidence (see playbook below)
  }

Your job:
  1. Read previousAttempt.phase and previousAttempt.details carefully.
  2. Diagnose the SPECIFIC root cause.
  3. Emit the FULL revised <challenge_assets> JSON. Preserve everything
     that worked; change ONLY what is needed to fix the failure. Do not
     rewrite the whole challenge from a clean slate.

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

function safeRel(rel) {
  // disallow leading slashes, ".." traversal, and absolute paths
  if (!rel || typeof rel !== 'string') return null;
  if (rel.includes('..')) return null;
  if (path.isAbsolute(rel)) return null;
  return rel.replace(/^\/+/, '');
}

function writeAssets(buildDir, assets) {
  fs.mkdirSync(buildDir, { recursive: true });

  if (assets.dockerCompose) {
    fs.writeFileSync(path.join(buildDir, 'docker-compose.yml'), assets.dockerCompose);
  }

  if (assets.services && typeof assets.services === 'object') {
    for (const [svc, files] of Object.entries(assets.services)) {
      const svcName = safeRel(svc);
      if (!svcName) continue;
      const svcDir = path.join(buildDir, 'services', svcName);
      fs.mkdirSync(svcDir, { recursive: true });
      for (const [fname, content] of Object.entries(files || {})) {
        const rel = safeRel(fname);
        if (!rel) continue;
        const dest = path.join(svcDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content);
      }
    }
  }

  if (assets.initFiles && typeof assets.initFiles === 'object') {
    const initDir = path.join(buildDir, 'init');
    fs.mkdirSync(initDir, { recursive: true });
    for (const [fname, content] of Object.entries(assets.initFiles)) {
      const rel = safeRel(fname);
      if (!rel) continue;
      // strip a leading "init/" if present, since we're already inside init/
      const inside = rel.startsWith('init/') ? rel.slice('init/'.length) : rel;
      const dest = path.join(initDir, inside);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content);
    }
  }

  const challenge = {
    id: assets.id || null,
    title: assets.title,
    description: assets.description,
    difficulty: assets.difficulty,
    category: assets.category,
    tags: assets.tags || [],
    finalized: false,
    sandboxType: 'compose',
    problemStatement: assets.problemStatement || null,
    validationSpec: assets.validationSpec || null,
  };
  fs.writeFileSync(
    path.join(buildDir, 'challenge.json'),
    `${JSON.stringify(challenge, null, 2)}\n`,
  );
  return challenge;
}

function cleanupBuild(buildDir) {
  try {
    fs.rmSync(buildDir, { recursive: true, force: true });
  } catch (e) {
    console.warn(`[build] cleanup failed for ${buildDir}: ${e.message}`);
  }
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

function cap(s, max) {
  if (!s) return s;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated ${str.length - max} chars]`;
}

// Pull whatever logs we can after a failed `docker compose up` / wait. If the
// project isn't even up yet (image build error), this typically returns
// stderr from previous build steps, which is still useful.
async function captureComposeLogs(buildDir, portMap) {
  try {
    const { stdout, stderr } = await composeManager.runCompose(
      ['logs', '--no-color', '--tail=200'],
      { cwd: buildDir, env: portMap ? Object.fromEntries(Object.entries(portMap).map(([k, v]) => [k, String(v)])) : {} },
    );
    return [stdout, stderr].filter(Boolean).join('\n');
  } catch (e) {
    return [e.stdout, e.stderr, e.message].filter(Boolean).join('\n');
  }
}

// Trim the previous-attempt blob before sending it back to the LLM so we
// don't blow the context window when service files are large.
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
    // Cap every string-valued leaf so a runaway service file can't dominate
    // the prompt budget.
    const safe = JSON.parse(JSON.stringify(prev.artifacts));
    if (typeof safe.dockerCompose === 'string') safe.dockerCompose = cap(safe.dockerCompose, 6000);
    if (safe.services) {
      for (const [svc, files] of Object.entries(safe.services)) {
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
    if (d.composeStdout) out.details.composeStdout = cap(d.composeStdout, 4000);
    if (d.composeStderr) out.details.composeStderr = cap(d.composeStderr, 4000);
    if (d.logs) out.details.logs = cap(d.logs, 8000);
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

async function runBuildLoop({ draft, draftSessionId, onEvent, terminalWsBase = null }) {
  if (!llm.isConfigured()) {
    const provider = llm.getProvider();
    const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    const e = new Error(`${keyName} is not configured (LLM_PROVIDER=${provider}) — cannot run the build pipeline`);
    e.code = 'LLM_NOT_CONFIGURED';
    onEvent({ type: 'error', message: e.message });
    throw e;
  }

  if (!draft || !draft.sandboxSpec) {
    const e = new Error('draft is missing sandboxSpec; finish the chat phase first');
    onEvent({ type: 'error', message: e.message });
    throw e;
  }

  fs.mkdirSync(BUILDS_ROOT, { recursive: true });

  const buildSessionId = uuidv4();
  const buildDir = path.join(BUILDS_ROOT, buildSessionId);

  // Structured carry-over between iterations. The LLM sees this as
  // `previousAttempt` in the user payload, so it knows exactly what it
  // emitted last time and why it failed.
  let lastAttempt = null;

  for (let attempt = 1; attempt <= MAX_ITERATIONS; attempt++) {
    onEvent({ type: 'phase', phase: 'GENERATE', attempt, total: MAX_ITERATIONS });
    onEvent({
      type: 'log',
      message: lastAttempt
        ? `[build] iteration ${attempt}/${MAX_ITERATIONS} — debug-mode (fixing previous ${lastAttempt.phase} failure)`
        : `[build] iteration ${attempt}/${MAX_ITERATIONS}`,
    });

    let assets;
    let rawText = null;
    try {
      const userPayload = JSON.stringify({
        draft,
        previousAttempt: sanitizePreviousAttempt(lastAttempt),
      }, null, 2);
      rawText = await llm.completeMessage({
        system: GENERATE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPayload }],
        maxTokens: 16384,
      });
      assets = extractAssets(rawText);
      if (!assets) throw new Error('LLM response did not contain <challenge_assets> JSON');
      onEvent({ type: 'log', message: `[generate] received ${JSON.stringify(summariseAssets(assets))}` });
    } catch (e) {
      onEvent({ type: 'log', message: `[generate] failed: ${e.message}` });
      lastAttempt = {
        phase: 'GENERATE',
        message: e.message,
        artifacts: null,
        rawText,
        details: null,
      };
      // eslint-disable-next-line no-continue
      continue;
    }

    onEvent({ type: 'phase', phase: 'WRITE', attempt, total: MAX_ITERATIONS });
    // wipe any leftover from a previous failed iteration so we start clean
    if (fs.existsSync(buildDir)) cleanupBuild(buildDir);
    let writtenChallenge;
    try {
      writtenChallenge = writeAssets(buildDir, assets);
      onEvent({ type: 'buildDir', buildDir });
      onEvent({ type: 'log', message: `[write] laid down ${buildDir}` });
    } catch (e) {
      onEvent({ type: 'log', message: `[write] failed: ${e.message}` });
      lastAttempt = {
        phase: 'WRITE',
        message: e.message,
        artifacts: assets,
        rawText: null,
        details: null,
      };
      // eslint-disable-next-line no-continue
      continue;
    }

    onEvent({ type: 'phase', phase: 'START', attempt, total: MAX_ITERATIONS });
    let portMap;
    try {
      const { content: composeYaml } = composeManager.readComposeFile(buildDir);
      portMap = await composeManager.resolvePortMap(
        buildDir, composeYaml, buildSessionId, { pool: 'build' },
      );
      onEvent({ type: 'log', message: `[start] allocated ports ${JSON.stringify(portMap)}` });
      await composeManager.up(buildDir, portMap);
      await composeManager.waitForServices(buildDir, portMap, 90_000);
      onEvent({ type: 'log', message: '[start] all services reported running' });
    } catch (e) {
      onEvent({ type: 'log', message: `[start] failed: ${e.message}` });
      if (e.stderr) onEvent({ type: 'log', message: `[start] stderr:\n${cap(e.stderr, 2000)}` });
      // Pull recent container logs BEFORE teardown so the LLM has real
      // evidence (compose errors usually say "container exited" — the
      // actual stack trace lives in the service's stdout).
      const logs = await captureComposeLogs(buildDir, portMap).catch(() => null);
      if (logs) {
        const head = logs.split('\n').slice(0, 40).join('\n');
        onEvent({ type: 'log', message: `[start] container logs (head):\n${head}` });
        onEvent({ type: 'log', message: `[start] captured ${logs.length} bytes for retry context` });
      }
      await composeManager.down(buildDir).catch(() => {});
      await portAllocator.releaseIn('build', buildSessionId).catch(() => {});
      lastAttempt = {
        phase: 'START',
        message: e.message,
        artifacts: assets,
        rawText: null,
        details: {
          composeStdout: e.stdout || null,
          composeStderr: e.stderr || null,
          logs,
        },
      };
      // eslint-disable-next-line no-continue
      continue;
    }

    onEvent({ type: 'phase', phase: 'VALIDATE', attempt, total: MAX_ITERATIONS });
    let validation;
    try {
      validation = await validationAgent.validate({
        buildDir,
        portMap,
        sandboxSpec: draft.sandboxSpec,
        validationSpec: assets.validationSpec,
        onLog: (m) => onEvent({ type: 'log', message: m }),
      });
      onEvent({ type: 'validation', result: validation });
    } catch (e) {
      onEvent({ type: 'log', message: `[validate] failed: ${e.message}` });
      await composeManager.down(buildDir).catch(() => {});
      await portAllocator.releaseIn('build', buildSessionId).catch(() => {});
      lastAttempt = {
        phase: 'VALIDATE',
        message: e.message,
        artifacts: assets,
        rawText: null,
        details: null,
      };
      // eslint-disable-next-line no-continue
      continue;
    }

    if (validation.passed) {
      const built = {
        ...writtenChallenge,
        buildSessionId,
        buildDir,
        portMap,
      };
      const terminalService = assets.validationSpec?.terminalService
        || (composeManager.extractServiceNames(fs.readFileSync(path.join(buildDir, 'docker-compose.yml'), 'utf8'))[0] || null);

      const terminalWsUrl = terminalWsBase
        ? `${terminalWsBase}/ws/terminal?sessionId=__build:${buildSessionId}&container=${encodeURIComponent(terminalService || '')}`
        : null;
      const metricsWsUrl = terminalWsBase
        ? `${terminalWsBase}/ws/metrics?sessionId=__build:${buildSessionId}`
        : null;

      onEvent({
        type: 'done',
        buildSessionId,
        builtChallenge: built,
        buildValidation: validation,
        terminalWsUrl,
        metricsWsUrl,
      });
      return {
        buildSessionId,
        buildDir,
        builtChallenge: built,
        buildValidation: validation,
        portMap,
        terminalService,
        attempts: attempt,
      };
    }

    // failed validation — tear down and feed structured feedback into next iter
    onEvent({ type: 'log', message: `[validate] judged FAIL: ${validation.feedback}` });
    await composeManager.down(buildDir).catch(() => {});
    await portAllocator.releaseIn('build', buildSessionId).catch(() => {});
    lastAttempt = {
      phase: 'VALIDATE',
      message: validation.feedback || 'validation rejected the build',
      artifacts: assets,
      rawText: null,
      details: {
        feedback: validation.feedback,
        suggestions: validation.suggestions || [],
        evidence: validation.evidence || [],
      },
    };
  }

  // exhausted retries
  cleanupBuild(buildDir);
  const err = new Error(`build pipeline exhausted ${MAX_ITERATIONS} iterations without a passing build`);
  err.lastFailure = lastAttempt
    ? `${lastAttempt.phase}: ${lastAttempt.message}`
    : null;
  err.lastAttempt = lastAttempt;
  onEvent({ type: 'error', message: err.message, lastAttempt });
  throw err;
}

async function teardownBuild(buildSessionId, buildDir) {
  if (buildDir) {
    try { await composeManager.down(buildDir); } catch (_e) { /* noop */ }
  }
  try { await portAllocator.releaseIn('build', buildSessionId); } catch (_e) { /* noop */ }
  if (buildDir) cleanupBuild(buildDir);
}

module.exports = {
  MAX_ITERATIONS,
  runBuildLoop,
  teardownBuild,
  extractAssets,
  writeAssets,
};
