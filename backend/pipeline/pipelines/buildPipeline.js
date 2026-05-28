'use strict';

// Build pipeline — runs up to MAX_ITERATIONS attempts of
// GENERATE (codeAgent) → WRITE → START → VALIDATE. Each attempt is fully
// self-contained: if validation fails, the compose stack is torn down and
// failure context is folded into the next codeAgent call.
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

const { assertLlmConfigured } = require('../agents/agentRuntime');
const codeAgent = require('../agents/codeAgent');
const composeManager = require('../../sandbox/composeManager');
const portAllocator = require('../../sandbox/portAllocator');
const validationAgent = require('../agents/validationAgent');
const lessonStore = require('../stores/lessonStore');
const { normalizeDraft, isDraftReady } = require('../draft/draftSchema');
// metricsObserver (OBSERVE phase) deferred to a future release — not run during build.
const { emitLog } = require('../build/buildLogger');
const { buildIterationChecklist } = require('../validation/validationChecklist');
const { BUILDS_ROOT } = require('../../sandbox/paths');

const MAX_ITERATIONS = 10;

// GENERATE (LLM) lives in codeAgent.js

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

function pickCategory(draft) {
  const n = normalizeDraft(draft);
  return n.meta?.category || n.category || n.sandboxSpec?.category || null;
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

function emitIterationSummary(onEvent, {
  attempt,
  total,
  failedPhase,
  validation,
  draft,
  validationSpec,
}) {
  const checklist = buildIterationChecklist({
    attempt,
    total,
    failedPhase,
    validation,
    draft,
    validationSpec,
  });
  const phaseLines = checklist.phases.map((p) => {
    const icon = p.status === 'pass' ? '✓' : p.status === 'fail' ? '✗' : '○';
    return `${icon} ${p.label}`;
  });
  const checkLines = checklist.items.map((i) => {
    const icon = i.status === 'pass' ? '✓' : i.status === 'fail' ? '✗' : i.status === 'skip' ? '–' : '○';
    return `${icon} ${i.label}`;
  });
  emitLog(onEvent, {
    level: checklist.passed ? 'ok' : (failedPhase ? 'warn' : 'info'),
    tag: 'build',
    message: checklist.passed
      ? `Iteration ${attempt}/${total} — validation passed`
      : `Iteration ${attempt}/${total} — ${failedPhase || 'pipeline'} did not complete`,
    detail: [...phaseLines, ...(checkLines.length ? ['', 'Validation checklist:', ...checkLines] : [])].join('\n'),
  });
  onEvent({ type: 'checklist', checklist });
}

async function runBuildLoop({ draft, draftSessionId, onEvent, terminalWsBase = null }) {
  try {
    assertLlmConfigured('code', { label: 'code agent (build pipeline)' });
  } catch (e) {
    onEvent({ type: 'error', message: e.message });
    throw e;
  }

  const normalized = normalizeDraft(draft);
  if (!isDraftReady(normalized)) {
    const e = new Error('draft is incomplete; need description, brokenState.rootCause, and infra.services');
    onEvent({ type: 'error', message: e.message });
    throw e;
  }

  const serviceSummary = (normalized.infra?.services || [])
    .map((s) => `${s.name} (${s.image_hint || 'no image'})`)
    .join(', ');
  emitLog(onEvent, {
    level: 'phase',
    tag: 'build',
    message: `Starting build pipeline (max ${MAX_ITERATIONS} iterations)`,
    detail: {
      title: normalized.meta?.name || normalized.title,
      services: serviceSummary,
      rootCause: cap(normalized.brokenState?.rootCause, 200),
    },
  });

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
    emitLog(onEvent, {
      level: 'phase',
      tag: 'build',
      message: retryHint
        ? `Iteration ${attempt}/${MAX_ITERATIONS} — retry after ${retryHint} failure`
        : `Iteration ${attempt}/${MAX_ITERATIONS}`,
    });

    let assets;
    let rawText = null;
    try {
      let lessonsBlock = { relatedLessons: [] };
      if (startFailureMsg || validateFailureMsg) {
        lessonsBlock = await lessonStore.findForRetry({
          draft: normalized,
          startFailureMsg,
          validateFailureMsg,
        });
        if (lessonsBlock.relatedLessons.length) {
          const best = lessonsBlock.relatedLessons[0];
          emitLog(onEvent, {
            level: 'info',
            tag: 'lessons',
            message: `Injecting ${lessonsBlock.relatedLessons.length} learned lesson(s)`,
            detail: `Top match similarity ${best.similarity != null ? best.similarity.toFixed(2) : 'n/a'}`,
          });
        }
      }

      const prevForGenerate = lastAttempt
        && (lastAttempt.phase === 'GENERATE' || lastAttempt.phase === 'WRITE')
        ? lastAttempt
        : null;

      emitLog(onEvent, {
        level: 'info',
        tag: 'generate',
        message: 'Calling code agent (draft infra is authoritative — no catalogue re-fetch)',
        detail: codeAgent.summariseAssets(lastAssets) || { services: serviceSummary },
      });

      const generated = await codeAgent.generateChallengeAssets({
        draft: normalized,
        lessonsBlock,
        lastAssets,
        startFailureMsg,
        validateFailureMsg,
        previousAttempt: prevForGenerate,
      });
      rawText = generated.rawText;
      assets = generated.assets;
      lastAssets = assets;
      emitLog(onEvent, {
        level: 'ok',
        tag: 'generate',
        message: 'Received challenge assets',
        detail: codeAgent.summariseAssets(assets),
      });
    } catch (e) {
      emitLog(onEvent, { level: 'error', tag: 'generate', message: e.message });
      lastAttempt = {
        phase: 'GENERATE',
        message: e.message,
        artifacts: null,
        rawText,
        details: null,
      };
      emitIterationSummary(onEvent, {
        attempt,
        total: MAX_ITERATIONS,
        failedPhase: 'GENERATE',
        validation: null,
        draft: normalized,
        validationSpec: lastAssets?.validationSpec,
      });
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
      emitLog(onEvent, {
        level: 'ok',
        tag: 'write',
        message: 'Wrote build artifacts',
        detail: buildDir,
      });
    } catch (e) {
      emitLog(onEvent, { level: 'error', tag: 'write', message: e.message });
      lastAttempt = {
        phase: 'WRITE',
        message: e.message,
        artifacts: assets,
        rawText: null,
        details: null,
      };
      emitIterationSummary(onEvent, {
        attempt,
        total: MAX_ITERATIONS,
        failedPhase: 'WRITE',
        validation: null,
        draft: normalized,
        validationSpec: assets?.validationSpec,
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    onEvent({ type: 'phase', phase: 'START', attempt, total: MAX_ITERATIONS });
    const buildCategory = normalized.meta?.category || normalized.category || null;
    let portMap;
    try {
      const { content: composeYaml } = composeManager.readComposeFile(buildDir);
      portMap = await composeManager.resolvePortMap(
        buildDir, composeYaml, buildSessionId, { pool: 'build' },
      );
      emitLog(onEvent, {
        level: 'info',
        tag: 'start',
        message: 'Allocated host ports',
        detail: portMap,
      });
      emitLog(onEvent, { level: 'info', tag: 'start', message: 'Running docker compose up…' });
      await composeManager.up(buildDir, portMap);
      await composeManager.waitForServices(buildDir, portMap, 90_000);
      emitLog(onEvent, { level: 'ok', tag: 'start', message: 'All services reported running' });

      startFailureMsg = null;
      if (startFailureHistory.length > 0) {
        const lessonId = await lessonStore.record({
          phase: 'start',
          draftSessionId,
          buildSessionId,
          category: buildCategory,
          title: normalized.meta?.name || normalized.title || assets?.title,
          draft: normalized,
          failures: [...startFailureHistory],
          assets,
        });
        if (lessonId) {
          emitLog(onEvent, {
            level: 'info',
            tag: 'lessons',
            message: `Recorded START lesson #${lessonId}`,
            detail: `${startFailureHistory.length} prior failure(s) before this success`,
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
      emitLog(onEvent, {
        level: 'error',
        tag: 'start',
        message: 'Compose start failed',
        detail: cap(cleanMsg, 1500),
      });
      if (cleanStderr) {
        emitLog(onEvent, {
          level: 'detail',
          tag: 'start',
          message: 'Compose stderr',
          detail: cap(cleanStderr, 1500),
        });
      }
      const rawLogs = await captureComposeLogs(buildDir, portMap).catch(() => null);
      const logs = rawLogs ? composeManager.stripDockerNoise(rawLogs) : null;
      if (logs) {
        const head = logs.split('\n').slice(0, 40).join('\n');
        emitLog(onEvent, {
          level: 'detail',
          tag: 'start',
          message: `Container logs (${logs.length} bytes captured)`,
          detail: head,
        });
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
      emitIterationSummary(onEvent, {
        attempt,
        total: MAX_ITERATIONS,
        failedPhase: 'START',
        validation: null,
        draft: normalized,
        validationSpec: assets?.validationSpec,
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    onEvent({ type: 'phase', phase: 'VALIDATE', attempt, total: MAX_ITERATIONS });
    let validation;
    try {
      validation = await validationAgent.validate({
        buildDir,
        portMap,
        sandboxSpec: normalized.sandboxSpec,
        draft: normalized,
        validationSpec: assets.validationSpec,
        onLog: (payload) => {
          if (typeof payload === 'string') {
            emitLog(onEvent, { level: 'info', tag: 'validate', message: payload });
          } else if (payload?.type) {
            onEvent(payload);
          } else {
            emitLog(onEvent, { tag: 'validate', ...payload });
          }
        },
      });
      onEvent({ type: 'validation', result: validation });
    } catch (e) {
      emitLog(onEvent, { level: 'error', tag: 'validate', message: e.message });
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
      emitIterationSummary(onEvent, {
        attempt,
        total: MAX_ITERATIONS,
        failedPhase: 'VALIDATE',
        validation: { passed: false, feedback: e.message, evidence: [], checklist: [] },
        draft: normalized,
        validationSpec: assets?.validationSpec,
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    emitIterationSummary(onEvent, {
      attempt,
      total: MAX_ITERATIONS,
      failedPhase: validation.passed ? null : 'VALIDATE',
      validation,
      draft: normalized,
      validationSpec: assets?.validationSpec,
    });

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
          title: normalized.meta?.name || normalized.title || assets?.title,
          draft: normalized,
          failures: [...validateFailureHistory],
          assets,
          validationFeedback: validation.feedback,
        });
        if (lessonId) {
          emitLog(onEvent, {
            level: 'info',
            tag: 'lessons',
            message: `Recorded VALIDATE lesson #${lessonId}`,
            detail: `${validateFailureHistory.length} prior failure(s) before this success`,
          });
        }
        validateFailureHistory.length = 0;
      }

      built.metrics = normalized.metrics;
      built.description = normalized.description;
      built.arch = normalized.arch;
      built.meta = normalized.meta;

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
        draft: normalized,
        portMap,
        terminalService,
        attempts: attempt,
      };
    }

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
  writeAssets,
  // Re-export for callers that imported from the old buildAgent module.
  extractAssets: codeAgent.extractAssets,
};
