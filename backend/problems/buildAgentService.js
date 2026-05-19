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
const memoryStore = require('./memoryStore');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILDS_ROOT = path.join(ROOT, 'sandbox', 'builds');

const MAX_ITERATIONS = 10;

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
8. \`build.context\` for any service you define under \`services\` MUST be
   exactly \`./services/<service-name>\` (matching the on-disk layout the
   writer uses). NEVER \`./<service-name>\` or any other path — the runner
   will reject the build before docker even pulls images.
9. For Docker image tags and service recipes, use memory.relatedLessons as the
   authoritative source. Never invent image tags or version numbers. If
   relatedLessons is empty, use only tags you are highly confident exist on
   Docker Hub.

The JSON inside <challenge_assets> must be strictly valid: no trailing commas,
no comments, all newlines inside string values escaped as \\n.

============================= MEMORY =============================
The user payload includes a \`memory\` object with the K most semantically
similar lessons retrieved from prior builds (across all drafts). Shape:

  {
    "relatedLessons": [
      {
        "text":       "<lesson paragraph — failures seen + working fix>",
        "category":   "<category slug or null>",
        "hitCount":   <how many builds have recorded this same lesson>,
        "similarity": <cosine similarity 0..1; higher = more relevant>,
        "details":    { "successMantra": "...", "workingCompose": "...", "failureHistory": [...] }
      },
      ...
    ]
  }

Lessons are recorded only after a phase SUCCEEDS (START or VALIDATE). Each
success lesson lists prior failures for that phase in \`text\` and stores
the working compose + guidance in \`details.successMantra\` and
\`details.workingCompose\`. Read \`details\` carefully — it is the
authoritative fix, not just the summary in \`text\`.

How to use it:
  - Prefer image tags, env vars, and service blocks from
    \`details.workingCompose\` when present.
  - Follow \`details.successMantra\` for how prior errors were resolved.
  - \`details.failureHistory\` lists what failed before the fix — avoid
    repeating those mistakes.
  - Higher \`similarity\` and \`hitCount\` mean stronger signal.
  - Docker image tags, env blocks, and service recipes come ONLY from
    \`relatedLessons\` (seed catalog + lessons from past builds).

If \`relatedLessons\` is empty, use only image tags you are highly confident
exist on Docker Hub. HARD RULES 1–8 still apply for compose structure,
Python services, ports, and metrics. Memory NEVER overrides HARD RULES 1–8.

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

// --- semantic memory ----------------------------------------------------
//
// Single retrieval path: build one query text (current draft brief +
// previous-attempt failure summary), embed it, ask Postgres for the K
// closest lessons. The LLM reads them as advisory paragraphs.
//
// Recording happens only on phase SUCCESS (START or VALIDATE). Each
// success lesson bundles prior failures for that phase in lesson_text and
// stores workingCompose + successMantra in details. VALIDATE pass also
// records one "image works" row per compose image.

const MEMORY_K = 8;
const MEMORY_MAX_DISTANCE = 0.45;

function pickCategory(draft) {
  return (
    draft?.category
    || draft?.sandboxSpec?.category
    || draft?.sandboxSpec?.brief?.category
    || null
  );
}

// Build the text we feed to the embedding model for retrieval. Mixes
// what the LLM is currently trying to do (draft brief) with the most
// recent failure context, so similar combined situations surface.
function buildRetrievalQuery({ draft, previousAttempt }) {
  const parts = [];
  const title = draft?.title || draft?.sandboxSpec?.title || draft?.sandboxSpec?.brief?.title;
  if (title) parts.push(`Title: ${title}`);
  const category = pickCategory(draft);
  if (category) parts.push(`Category: ${category}`);
  const services = draft?.sandboxSpec?.services || draft?.sandboxSpec?.brief?.services;
  if (Array.isArray(services) && services.length) {
    parts.push(`Services: ${services.slice(0, 12).join(', ')}`);
  }
  const description = draft?.sandboxSpec?.description || draft?.sandboxSpec?.brief?.description;
  if (description) parts.push(`Description: ${cap(description, 600)}`);

  if (previousAttempt) {
    parts.push(`Previous attempt failed at ${previousAttempt.phase}.`);
    if (previousAttempt.message) parts.push(`Error: ${cap(previousAttempt.message, 600)}`);
    const d = previousAttempt.details || {};
    if (d.composeStderr) parts.push(`Compose stderr:\n${cap(d.composeStderr, 800)}`);
    if (d.logs) parts.push(`Container logs:\n${cap(d.logs, 800)}`);
    if (d.feedback) parts.push(`Validation feedback: ${cap(d.feedback, 400)}`);
  }
  return parts.join('\n');
}

const PROMPT_DETAILS_COMPOSE_MAX = 2500;
const PROMPT_DETAILS_MANTRA_MAX = 600;
const PROMPT_FAILURE_HISTORY_MAX = 5;

// What the LLM sees inside `memory.relatedLessons[]`.
function shapeLessonForPrompt(lesson) {
  const out = {
    text: cap(lesson.text, 2000),
    category: lesson.category || null,
    hitCount: lesson.hitCount,
    similarity: lesson.distance != null
      ? Math.max(0, Math.min(1, 1 - lesson.distance))
      : null,
  };
  const details = shapeDetailsForPrompt(lesson.details);
  if (details) out.details = details;
  return out;
}

function shapeDetailsForPrompt(details) {
  if (!details || typeof details !== 'object') return null;
  const out = {};
  if (details.successMantra) {
    out.successMantra = cap(String(details.successMantra), PROMPT_DETAILS_MANTRA_MAX);
  }
  if (details.workingCompose) {
    out.workingCompose = cap(String(details.workingCompose), PROMPT_DETAILS_COMPOSE_MAX);
  }
  if (Array.isArray(details.failureHistory) && details.failureHistory.length) {
    out.failureHistory = details.failureHistory
      .slice(0, PROMPT_FAILURE_HISTORY_MAX)
      .map((f) => ({
        attempt: f.attempt,
        phase: f.phase,
        message: cap(f.message || '', 400),
      }));
  }
  if (details.image) out.image = details.image;
  if (details.recordType) out.recordType = details.recordType;
  return Object.keys(out).length ? out : null;
}

async function buildMemoryBlock({ draft, previousAttempt }) {
  const queryText = buildRetrievalQuery({ draft, previousAttempt });
  const category = pickCategory(draft);
  const isFirstIteration = !previousAttempt;

  const semanticHits = queryText
    ? await memoryStore.findSimilar({
        text: queryText,
        k: MEMORY_K,
        maxDistance: MEMORY_MAX_DISTANCE,
        category,
      })
    : [];

  const bySig = new Map();
  for (const hit of semanticHits) {
    bySig.set(hit.signature, hit);
  }

  if (isFirstIteration) {
    const baselineCats = [];
    if (category) baselineCats.push(category);
    if (!baselineCats.includes('docker-images')) baselineCats.push('docker-images');
    
    // This is only for first iteration, to get some category wise lookup as well as there are 
    // no previous attempts.
    for (const cat of baselineCats) {
      const extra = await memoryStore.topByCategory(cat, 3);
      for (const row of extra) {
        if (!bySig.has(row.signature)) {
          bySig.set(row.signature, { ...row, distance: row.distance ?? 0.5 });
        }
      }
    }
  }

  let merged = [...bySig.values()];
  merged.sort((a, b) => {
    const da = a.distance ?? 999;
    const db = b.distance ?? 999;
    if (da !== db) return da - db;
    return (b.hitCount || 0) - (a.hitCount || 0);
  });
  merged = merged.slice(0, MEMORY_K);

  return {
    relatedLessons: merged.map(shapeLessonForPrompt),
  };
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

// Construct a prose lesson paragraph for a build failure. Stable wording
// for stable causes (image refs, env vars, modules) so the SHA dedup
// works without us needing a kind column.
function failureLessonText({ phase, message, details = {}, category }) {
  const cleanedMsg = cap(message || '', 800);
  const lines = [];

  const imageMatch = /failed to resolve reference "([^"]+)"/.exec(`${cleanedMsg}\n${details.composeStderr || ''}`);
  if (imageMatch) {
    const ref = imageMatch[1].replace(/^docker\.io\//, '');
    lines.push(`Docker image \`${ref}\` failed to resolve on Docker Hub during the ${phase} phase of a build. The tag either does not exist or has been removed. Avoid this image; pick a tag that has been confirmed to pull.`);
  }

  const envMatch = /environment variable "([^"]+)" is not set/.exec(`${cleanedMsg}\n${details.logs || ''}`);
  if (envMatch) {
    lines.push(`A container exited at ${phase} because the required environment variable \`${envMatch[1]}\` was not set. The service entrypoint refuses to start without it; set it in the compose service's \`environment\` block.`);
  }

  const moduleMatch = /ModuleNotFoundError: No module named '([^']+)'/.exec(details.logs || '');
  if (moduleMatch) {
    lines.push(`A Python service crashed at ${phase} with \`ModuleNotFoundError: No module named '${moduleMatch[1]}'\`. The module must be added to that service's \`requirements.txt\` and the Dockerfile must \`pip install -r requirements.txt\` before launching the app.`);
  }

  if (/kafka\.errors\.NoBrokersAvailable/.test(details.logs || '')) {
    lines.push(`A Kafka client raised \`NoBrokersAvailable\` at ${phase}. Either the Kafka broker is not yet listening, or the bootstrap server hostname/port is wrong. Wrap producer/consumer init in a retry-with-backoff loop and verify \`bootstrap_servers\` points to the in-network broker (e.g. \`kafka:9092\`).`);
  }

  if (/psycopg2\.OperationalError/.test(details.logs || '')) {
    lines.push(`A Postgres client raised \`psycopg2.OperationalError\` at ${phase}. The DB may not be ready yet, the hostname/port may be wrong, or credentials don't match. Gate dependents on a postgres healthcheck and confirm the connection string matches the compose service name.`);
  }

  if (lines.length === 0) {
    // Generic fallback so we still record SOMETHING semantically searchable.
    lines.push(`A build at ${phase} failed${category ? ` (category: ${category})` : ''}. Error: ${cleanedMsg || '(no message)'}.`);
  }

  return lines.join(' ');
}

function buildPhaseSuccessLessonText({ phase, category, failures, compose }) {
  const lines = [];
  lines.push(
    `${phase} phase succeeded${category ? ` for category ${category}` : ''}.`,
  );
  if (failures.length > 0) {
    lines.push(`Failures observed before this success (${failures.length}):`);
    for (const f of failures) {
      lines.push(`- Attempt ${f.attempt} (${f.phase}): ${f.message}`);
    }
  } else {
    lines.push('No prior failures for this phase in the same build.');
  }
  lines.push('Working compose configuration that resolved the issue:');
  lines.push(cap(compose, 2200));
  return lines.join('\n');
}

function buildSuccessMantra({ phase, failures, compose }) {
  const parts = [];
  if (failures.length > 0) {
    parts.push(
      `After ${failures.length} failed ${phase} attempt(s), all services reached a good state. `
      + 'Reuse the exact image tags, environment variables, and service definitions in workingCompose. '
      + 'Do not repeat the mistakes listed in failureHistory.',
    );
    for (const f of failures.slice(0, 4)) {
      const hint = failureLessonText({
        phase: f.phase,
        message: f.message,
        details: {
          composeStderr: f.composeStderr,
          logs: f.logs,
          feedback: f.feedback,
        },
        category: null,
      });
      parts.push(`Prior failure (attempt ${f.attempt}): ${cap(f.message, 200)} → ${cap(hint, 300)}`);
    }
  } else {
    parts.push(
      `${phase} succeeded on the first try for this build. `
      + 'Reuse workingCompose as the baseline for similar challenges.',
    );
  }
  parts.push(`Compose keys: ${cap(compose, 800)}`);
  return parts.join(' ');
}

// Record a success lesson when START or VALIDATE passes. Bundles all prior
// failures for that phase in lesson_text and stores the working compose +
// successMantra in details for cross-build retrieval.
async function recordPhaseSuccessLessons({
  phase,
  assets,
  category,
  failures = [],
  attempt,
}) {
  const compose = assets?.dockerCompose || '';
  if (!compose.trim()) return;

  const text = buildPhaseSuccessLessonText({ phase, category, failures, compose });
  const successMantra = buildSuccessMantra({ phase, failures, compose });

  await memoryStore.record({
    text,
    details: {
      recordType: phase === 'START' ? 'start-success' : 'validate-success',
      phase,
      attempt,
      successMantra,
      workingCompose: cap(compose, 3500),
      failureHistory: failures,
    },
    category,
  });
}

// One "image works" lesson per image in a fully validated compose.
async function recordImageWorksLessons({ assets, category }) {
  const compose = assets?.dockerCompose || '';
  for (const image of extractImagesFromCompose(compose)) {
    const text = `Docker image \`${image}\` was used successfully in a validated build${category ? ` for the ${category} category` : ''}. It is a known-good tag — safe to reuse for similar challenges.`;
    await memoryStore.record({
      text,
      details: { recordType: 'image-works', image, fromCategory: category || null },
      category,
    });
  }
}

// Minimal local image extractor (kept in-file since lessonSignatures is
// gone). One row per `image:` value.
function extractImagesFromCompose(yaml) {
  if (!yaml || typeof yaml !== 'string') return [];
  const out = new Set();
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s+image\s*:\s*['"]?([^\s'"#]+)['"]?\s*(?:#.*)?$/);
    if (m) out.add(m[1]);
  }
  return Array.from(out);
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
  // Failures accumulated until START / VALIDATE succeed — written once as
  // part of a success lesson (not as standalone failure rows).
  const startFailureHistory = [];
  const validateFailureHistory = [];

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
    let memoryBlock = null;
    try {
      memoryBlock = await buildMemoryBlock({ draft, previousAttempt: lastAttempt });
      if (memoryBlock.relatedLessons.length) {
        const best = memoryBlock.relatedLessons[0];
        onEvent({
          type: 'log',
          message: `[memory] injecting ${memoryBlock.relatedLessons.length} related lessons (top similarity ${best.similarity != null ? best.similarity.toFixed(2) : 'n/a'})`,
        });
      }
      const userPayload = JSON.stringify({
        draft,
        memory: memoryBlock,
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

      await recordPhaseSuccessLessons({
        phase: 'START',
        assets,
        category: buildCategory,
        failures: startFailureHistory,
        attempt,
      });
      if (startFailureHistory.length > 0) {
        onEvent({
          type: 'log',
          message: `[memory] recorded START success lesson (${startFailureHistory.length} prior failure(s) bundled)`,
        });
      }
      startFailureHistory.length = 0;
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
      lastAttempt = {
        phase: 'START',
        message: cleanMsg || e.message,
        artifacts: assets,
        rawText: null,
        details: {
          composeStdout: cleanStdout || null,
          composeStderr: cleanStderr || null,
          logs,
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

      await recordPhaseSuccessLessons({
        phase: 'VALIDATE',
        assets,
        category: buildCategory,
        failures: validateFailureHistory,
        attempt,
      });
      validateFailureHistory.length = 0;
      await recordImageWorksLessons({ assets, category: buildCategory });
      onEvent({
        type: 'log',
        message: '[memory] recorded VALIDATE success + image-works lessons',
      });

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
