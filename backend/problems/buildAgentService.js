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
const specialistStore = require('./specialistStore');
const lessonStore = require('./lessonStore');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILDS_ROOT = path.join(ROOT, 'sandbox', 'builds');

const MAX_ITERATIONS = 10;

const GENERATE_SYSTEM_PROMPT = `You are the Build Agent for "Devlabs".
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
9. For Docker image tags, env blocks, and service recipes, use specialistBrief
   entries (dos, donts, conf) as the authoritative source. Apply every conf
   block to compose environment or service files so containers pick them up
   at startup. Never invent image tags or version numbers.

The JSON inside <challenge_assets> must be strictly valid: no trailing commas,
no comments, all newlines inside string values escaped as \\n.

============================= SPECIALIST BRIEF =============================
The user payload includes \`specialistBrief\` — static handbook rows for this
draft's category/stacks. Shape:

  {
    "category": "...",
    "matchedCategories": ["global", "postgres", ...],
    "entries": [
      {
        "category": "postgres",
        "stack": "postgres",
        "title": "postgres:16-alpine",
        "dos": ["..."],
        "donts": ["NEVER use bitnami/..."],
        "conf": {
          "image": "postgres:16-alpine",
          "composeFragment": { "environment": { "POSTGRES_USER": "postgres", ... } },
          "inNetwork": { "host": "postgres", "port": 5432 }
        }
      }
    ]
  }

Follow ALL dos/donts. Materialize EVERY conf block in docker-compose.yml or
service files so containers load them at startup. specialistBrief is the
authoritative source for images and env — never invent tags.

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
  return sanitizePreviousAttempt({ phase: 'RETRY', message: '', artifacts: assets, details: null }).artifacts;
}

function pickCategory(draft) {
  return (
    draft?.category
    || draft?.sandboxSpec?.category
    || draft?.sandboxSpec?.brief?.category
    || null
  );
}

// Snapshot a failed attempt for in-build history (recorded later inside a
// success lesson, not as a standalone failure row).
function captureFailureSnapshot({ attempt, phase, lastAttempt }) {
  if (!lastAttempt) return null;
  return {
    attempt,
    phase,
    message: cap(lastAttempt.message || '', 600),
    composeSnippet: cap(lastAttempt.artifacts?.dockerCompose || '', 1200),
    composeStderr: cap(lastAttempt.details?.composeStderr, 600),
    logs: cap(lastAttempt.details?.logs, 600),
    feedback: cap(lastAttempt.details?.feedback, 400),
  };
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

  let lastAttempt = null;
  let lastAssets = null;
  let startFailureMsg = null;
  let validateFailureMsg = null;
  const startFailureHistory = [];
  const validateFailureHistory = [];

  for (let attempt = 1; attempt <= MAX_ITERATIONS; attempt++) {
    onEvent({ type: 'phase', phase: 'GENERATE', attempt, total: MAX_ITERATIONS });
    const retryHint = startFailureMsg
      ? 'START'
      : (validateFailureMsg ? 'VALIDATE' : (lastAttempt ? lastAttempt.phase : null));
    onEvent({
      type: 'log',
      message: retryHint
        ? `[build] iteration ${attempt}/${MAX_ITERATIONS} — fixing previous ${retryHint} failure`
        : `[build] iteration ${attempt}/${MAX_ITERATIONS}`,
    });

    let assets;
    let rawText = null;
    try {
      const specialistBrief = await specialistStore.buildBrief({ draft });
      if (specialistBrief.entries.length) {
        onEvent({
          type: 'log',
          message: `[specialists] injecting ${specialistBrief.entries.length} handbook entries (${specialistBrief.matchedCategories.join(', ')})`,
        });
      }

      let lessonsBlock = { relatedLessons: [] };
      if (startFailureMsg || validateFailureMsg) {
        lessonsBlock = await lessonStore.findForRetry({
          draft,
          startFailureMsg,
          validateFailureMsg,
        });
        if (lessonsBlock.relatedLessons.length) {
          const best = lessonsBlock.relatedLessons[0];
          onEvent({
            type: 'log',
            message: `[lessons] injecting ${lessonsBlock.relatedLessons.length} learned lesson(s) (top similarity ${best.similarity != null ? best.similarity.toFixed(2) : 'n/a'})`,
          });
        }
      }

      const prevForGenerate = lastAttempt
        && (lastAttempt.phase === 'GENERATE' || lastAttempt.phase === 'WRITE')
        ? lastAttempt
        : null;

      const userPayload = JSON.stringify({
        draft,
        specialistBrief,
        lessonsBlock,
        challengeAssets: sanitizeAssets(lastAssets),
        startFailureMsg,
        validateFailureMsg,
        previousAttempt: sanitizePreviousAttempt(prevForGenerate),
      }, null, 2);
      rawText = await llm.completeMessage({
        system: GENERATE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPayload }],
        maxTokens: 16384,
      });
      assets = extractAssets(rawText);
      if (!assets) throw new Error('LLM response did not contain <challenge_assets> JSON');
      lastAssets = assets;
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
      // Validate every build.context referenced by the compose file actually
      // exists on disk with a Dockerfile. Catches the very common mistake of
      // emitting `build: ./service-name` while the writer puts files under
      // `./services/service-name` — without this, START wastes 30-60s pulling
      // base images before docker discovers the missing directory.
      const composeYaml = assets.dockerCompose || '';
      const buildCtxs = composeManager.extractBuildContexts(composeYaml);
      const issues = [];
      for (const { service, contextPath } of buildCtxs) {
        const ctxAbs = path.resolve(buildDir, contextPath);
        if (!ctxAbs.startsWith(`${buildDir}${path.sep}`) && ctxAbs !== buildDir) {
          issues.push(`service "${service}": build.context "${contextPath}" escapes the build dir`);
          continue;
        }
        if (!fs.existsSync(ctxAbs) || !fs.statSync(ctxAbs).isDirectory()) {
          issues.push(`service "${service}": build.context "${contextPath}" — directory does not exist on disk`);
          continue;
        }
        if (!fs.existsSync(path.join(ctxAbs, 'Dockerfile'))) {
          issues.push(`service "${service}": build.context "${contextPath}" — Dockerfile missing inside the directory`);
        }
      }
      if (issues.length > 0) {
        throw new Error(
          `compose references build contexts that don't exist on disk: ${issues.join('; ')}. `
          + 'Rule of thumb: use `build.context: ./services/<service-name>` so the path matches the writer layout. '
          + 'The writer always places service files under `./services/<service-name>/Dockerfile` etc.',
        );
      }
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
    const buildCategory = draft?.category || draft?.sandboxSpec?.category || null;
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

      startFailureMsg = null;
      if (startFailureHistory.length > 0) {
        const lessonId = await lessonStore.record({
          phase: 'start',
          draftSessionId,
          buildSessionId,
          category: buildCategory,
          title: draft?.title || assets?.title,
          draft,
          failures: [...startFailureHistory],
          assets,
        });
        if (lessonId) {
          onEvent({
            type: 'log',
            message: `[lessons] recorded START lesson id=${lessonId} (${startFailureHistory.length} prior failure(s))`,
          });
        }
        startFailureHistory.length = 0;
      }
    } catch (e) {
      // Strip docker pull-progress noise BEFORE we log, show, or stash for
      // retry. Without this, a single failed Kafka pull can dump 250KB of
      // "Downloading [==>]" lines into the retry context and blow the LLM's
      // token-per-minute budget on the very next iteration.
      const cleanMsg = composeManager.stripDockerNoise(e.message || '');
      const cleanStderr = composeManager.stripDockerNoise(e.stderr || '');
      const cleanStdout = composeManager.stripDockerNoise(e.stdout || '');
      onEvent({ type: 'log', message: `[start] failed: ${cap(cleanMsg, 1500)}` });
      if (cleanStderr) onEvent({ type: 'log', message: `[start] stderr:\n${cap(cleanStderr, 1500)}` });
      // Pull recent container logs BEFORE teardown so the LLM has real
      // evidence (compose errors usually say "container exited" — the
      // actual stack trace lives in the service's stdout).
      const rawLogs = await captureComposeLogs(buildDir, portMap).catch(() => null);
      const logs = rawLogs ? composeManager.stripDockerNoise(rawLogs) : null;
      if (logs) {
        const head = logs.split('\n').slice(0, 40).join('\n');
        onEvent({ type: 'log', message: `[start] container logs (head):\n${head}` });
        onEvent({ type: 'log', message: `[start] captured ${logs.length} bytes for retry context` });
      }
      await composeManager.down(buildDir).catch(() => {});
      await portAllocator.releaseIn('build', buildSessionId).catch(() => {});
      startFailureMsg = {
        message: cleanMsg || e.message,
        composeStdout: cleanStdout || null,
        composeStderr: cleanStderr || null,
        logs,
      };
      lastAttempt = {
        phase: 'START',
        message: startFailureMsg.message,
        artifacts: assets,
        rawText: null,
        details: {
          composeStdout: startFailureMsg.composeStdout,
          composeStderr: startFailureMsg.composeStderr,
          logs: startFailureMsg.logs,
        },
      };
      const snap = captureFailureSnapshot({ attempt, phase: 'START', lastAttempt });
      if (snap) startFailureHistory.push(snap);
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
      const snap = captureFailureSnapshot({ attempt, phase: 'VALIDATE', lastAttempt });
      if (snap) validateFailureHistory.push(snap);
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

      validateFailureMsg = null;
      if (validateFailureHistory.length > 0) {
        const lessonId = await lessonStore.record({
          phase: 'validate',
          draftSessionId,
          buildSessionId,
          category: buildCategory,
          title: draft?.title || assets?.title,
          draft,
          failures: [...validateFailureHistory],
          assets,
          validationFeedback: validation.feedback,
        });
        if (lessonId) {
          onEvent({
            type: 'log',
            message: `[lessons] recorded VALIDATE lesson id=${lessonId} (${validateFailureHistory.length} prior failure(s))`,
          });
        }
        validateFailureHistory.length = 0;
      }

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

    onEvent({ type: 'log', message: `[validate] judged FAIL: ${validation.feedback}` });
    await composeManager.down(buildDir).catch(() => {});
    await portAllocator.releaseIn('build', buildSessionId).catch(() => {});
    validateFailureMsg = {
      message: validation.feedback || 'validation rejected the build',
      suggestions: validation.suggestions || [],
      evidence: (validation.evidence || []).map((ev) => ({
        step: ev.step,
        ok: ev.ok,
        stdout: cap(ev.stdout, 1500),
        stderr: cap(ev.stderr, 800),
        error: ev.error,
      })),
    };
    lastAttempt = {
      phase: 'VALIDATE',
      message: validateFailureMsg.message,
      artifacts: assets,
      rawText: null,
      details: {
        feedback: validation.feedback,
        suggestions: validation.suggestions || [],
        evidence: validation.evidence || [],
      },
    };
    const snap = captureFailureSnapshot({ attempt, phase: 'VALIDATE', lastAttempt });
    if (snap) validateFailureHistory.push(snap);
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
