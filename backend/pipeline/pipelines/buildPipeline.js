'use strict';

// Build pipeline — runs up to MAX_ITERATIONS attempts of
// GENERATE (codeAgent) → WRITE → SPIN → VALIDATE. Each attempt is fully
// self-contained: if validation fails, the compose stack is torn down and
// failure context is folded into the next codeAgent call.
//
// The caller drives the loop via `runBuildLoop({ draft, draftSessionId,
// onEvent, ... })`. `onEvent` receives SSE-shaped events:
//   { type: 'log',       message }
//   { type: 'phase',     phase: 'GENERATE|WRITE|SPIN|VALIDATE', attempt, total }
//   { type: 'buildDir',  buildDir }
//   { type: 'validation', result: { passed, feedback, ... } }
//   { type: 'done',      buildSessionId, builtChallenge, buildValidation,
//                        terminalWsUrl, metricsWsUrl }
//   { type: 'error',     message }

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { assertLlmConfigured } = require('../helpers/agentRuntime');
const codeAgent = require('../agents/codeAgent');
const spinAgent = require('../agents/spinAgent');
const composeManager = require('../../sandbox/composeManager');
const portAllocator = require('../../sandbox/portAllocator');
const validationAgent = require('../agents/validationAgent');
const lessonStore = require('../stores/lessonStore');
const { normalizeDraft, isDraftReady } = require('../draft/draftSchema');
// metricsObserver (OBSERVE phase) deferred to a future release — not run during build.
const { emitLog } = require('../build/buildLogger');
const { buildIterationChecklist } = require('../validation/validationChecklist');
const { BUILDS_ROOT } = require('../../sandbox/paths');

const MAX_ITERATIONS = 3;

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

function loadResumeContext(resumeBuildDir) {
  if (!resumeBuildDir || !fs.existsSync(resumeBuildDir)) return null;
  try {
    const challengeRaw = fs.readFileSync(path.join(resumeBuildDir, 'challenge.json'), 'utf8');
    const challenge = JSON.parse(challengeRaw);
    const composeRaw = fs.readFileSync(path.join(resumeBuildDir, 'docker-compose.yml'), 'utf8');

    const services = {};
    const servicesDir = path.join(resumeBuildDir, 'services');
    if (fs.existsSync(servicesDir)) {
      for (const svc of fs.readdirSync(servicesDir)) {
        const svcPath = path.join(servicesDir, svc);
        if (!fs.statSync(svcPath).isDirectory()) continue;
        services[svc] = {};
        for (const file of fs.readdirSync(svcPath)) {
          services[svc][file] = fs.readFileSync(path.join(svcPath, file), 'utf8');
        }
      }
    }

    const initFiles = {};
    const initDir = path.join(resumeBuildDir, 'init');
    if (fs.existsSync(initDir)) {
      for (const file of fs.readdirSync(initDir)) {
        initFiles[file] = fs.readFileSync(path.join(initDir, file), 'utf8');
      }
    }

    return {
      assets: {
        title: challenge.title,
        description: challenge.description,
        difficulty: challenge.difficulty,
        category: challenge.category,
        tags: challenge.tags,
        problemStatement: challenge.problemStatement,
        dockerCompose: composeRaw,
        services,
        initFiles,
        validationSpec: challenge.validationSpec,
      },
    };
  } catch (e) {
    console.warn(`[build] failed to load resume context from ${resumeBuildDir}: ${e.message}`);
    return null;
  }
}

async function runBuildLoop({
  draft, draftSessionId, onEvent, terminalWsBase = null,
  resumeBuildDir = null, resumeFailurePhase = null, resumeFailureMsg = null,
}) {
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

  // Load assets + failure context from a prior failed build if requested
  const resumeCtx = resumeBuildDir ? loadResumeContext(resumeBuildDir) : null;

  emitLog(onEvent, {
    level: 'phase',
    tag: 'build',
    message: resumeCtx
      ? `Resuming build pipeline from prior ${resumeFailurePhase || 'VALIDATE'} failure (max ${MAX_ITERATIONS} iterations)`
      : `Starting build pipeline (max ${MAX_ITERATIONS} iterations)`,
    detail: {
      title: normalized.meta?.name || normalized.title,
      services: serviceSummary,
      rootCause: cap(normalized.brokenState?.rootCause, 200),
      ...(resumeCtx ? { resumedFrom: resumeBuildDir } : {}),
    },
  });

  fs.mkdirSync(BUILDS_ROOT, { recursive: true });

  const buildSessionId = uuidv4();
  const buildDir = path.join(BUILDS_ROOT, buildSessionId);

  let lastAttempt = null;
  let lastAssets = resumeCtx?.assets || null;
  let spinFailureMsg = (resumeCtx && resumeFailurePhase === 'SPIN') ? resumeFailureMsg : null;
  let validateFailureMsg = (resumeCtx && resumeFailurePhase === 'VALIDATE') ? resumeFailureMsg : null;
  const spinFailureHistory = [];
  const validateFailureHistory = [];

  // Warm-start: query lessons using draft context before iteration 1.
  // This gives the code agent category-level patterns from past builds even
  // on the very first attempt — no failure message required.
  let warmLessons = { relatedLessons: [] };
  try {
    warmLessons = await lessonStore.findByDraftContext(normalized);
    if (warmLessons.relatedLessons.length) {
      const best = warmLessons.relatedLessons[0];
      emitLog(onEvent, {
        level: 'info',
        tag: 'lessons',
        message: `Warm-start: injecting ${warmLessons.relatedLessons.length} lesson(s) before iteration 1`,
        detail: `Top match similarity ${best.similarity != null ? best.similarity.toFixed(2) : 'n/a'} (${best.type || 'fix'})`,
      });
    }
  } catch (e) {
    console.warn(`[lessons] findByDraftContext failed: ${e.message}`);
  }

  for (let attempt = 1; attempt <= MAX_ITERATIONS; attempt++) {
    onEvent({ type: 'phase', phase: 'GENERATE', attempt, total: MAX_ITERATIONS });
    const retryHint = spinFailureMsg
      ? 'SPIN'
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
      if (spinFailureMsg || validateFailureMsg) {
        // Iteration 2+: retry-specific lessons (failure-message similarity)
        lessonsBlock = await lessonStore.findForRetry({
          draft: normalized,
          spinFailureMsg,
          validateFailureMsg,
        });
        // Merge in warm-start lessons not already present
        if (warmLessons.relatedLessons.length) {
          const existingIds = new Set(lessonsBlock.relatedLessons.map((l) => l.text));
          const extras = warmLessons.relatedLessons.filter((l) => !existingIds.has(l.text));
          if (extras.length) {
            lessonsBlock = {
              relatedLessons: [...lessonsBlock.relatedLessons, ...extras],
            };
          }
        }
        if (lessonsBlock.relatedLessons.length) {
          const best = lessonsBlock.relatedLessons[0];
          emitLog(onEvent, {
            level: 'info',
            tag: 'lessons',
            message: `Injecting ${lessonsBlock.relatedLessons.length} lesson(s) (retry)`,
            detail: `Top match similarity ${best.similarity != null ? best.similarity.toFixed(2) : 'n/a'} (${best.type || 'fix'})`,
          });
        }
      } else if (attempt === 1 && warmLessons.relatedLessons.length) {
        // Iteration 1: use warm-start lessons only
        lessonsBlock = warmLessons;
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
        spinFailureMsg,
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
      // `./services/service-name` — without this, SPIN wastes 30-60s pulling
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

    onEvent({ type: 'phase', phase: 'SPIN', attempt, total: MAX_ITERATIONS });
    const buildCategory = normalized.meta?.category || normalized.category || null;
    let portMap;
    try {
      ({ portMap } = await spinAgent.spin({
        buildDir,
        buildSessionId,
        onEvent,
        readyServices: assets.validationSpec?.readyServices || null,
      }));

      spinFailureMsg = null;
      if (spinFailureHistory.length > 0) {
        const lessonId = await lessonStore.record({
          type: 'fix',
          phase: 'spin',
          draftSessionId,
          buildSessionId,
          category: buildCategory,
          title: normalized.meta?.name || normalized.title || assets?.title,
          draft: normalized,
          failures: [...spinFailureHistory],
          assets,
        });
        if (lessonId) {
          emitLog(onEvent, {
            level: 'info',
            tag: 'lessons',
            message: `Recorded SPIN fix-lesson #${lessonId}`,
            detail: `${spinFailureHistory.length} prior failure(s) before this success`,
          });
        }
        spinFailureHistory.length = 0;
      }
    } catch (e) {
      spinFailureMsg = {
        message: e.message,
        composeStdout: e.composeStdout || null,
        composeStderr: e.composeStderr || null,
        logs: e.logs || null,
      };
      lastAttempt = {
        phase: 'SPIN',
        message: spinFailureMsg.message,
        artifacts: assets,
        rawText: null,
        details: {
          composeStdout: spinFailureMsg.composeStdout,
          composeStderr: spinFailureMsg.composeStderr,
          logs: spinFailureMsg.logs,
        },
      };
      const snap = captureFailureSnapshot({ attempt, phase: 'SPIN', lastAttempt });
      if (snap) spinFailureHistory.push(snap);
      emitIterationSummary(onEvent, {
        attempt,
        total: MAX_ITERATIONS,
        failedPhase: 'SPIN',
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
          type: 'fix',
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
            message: `Recorded VALIDATE fix-lesson #${lessonId}`,
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

  // exhausted retries — record anti-pattern lessons from both failure histories
  const lessonTitle = normalized.meta?.name || normalized.title || lastAssets?.title;
  if (spinFailureHistory.length > 0) {
    lessonStore.record({
      type: 'anti-pattern',
      phase: 'spin',
      draftSessionId,
      buildSessionId,
      category: buildCategory,
      title: lessonTitle,
      draft: normalized,
      failures: [...spinFailureHistory],
      assets: lastAssets,
    }).then((id) => {
      if (id) console.log(`[lessons] Recorded SPIN anti-pattern #${id} (${spinFailureHistory.length} failure(s))`);
    }).catch((e) => console.warn(`[lessons] anti-pattern record failed: ${e.message}`));
  }
  if (validateFailureHistory.length > 0) {
    lessonStore.record({
      type: 'anti-pattern',
      phase: 'validate',
      draftSessionId,
      buildSessionId,
      category: buildCategory,
      title: lessonTitle,
      draft: normalized,
      failures: [...validateFailureHistory],
      assets: lastAssets,
    }).then((id) => {
      if (id) console.log(`[lessons] Recorded VALIDATE anti-pattern #${id} (${validateFailureHistory.length} failure(s))`);
    }).catch((e) => console.warn(`[lessons] anti-pattern record failed: ${e.message}`));
  }

  const failedBuildDir = process.env.KEEP_FAILED_BUILDS === 'true' ? buildDir : null;
  if (failedBuildDir) {
    console.warn(`[build] KEEP_FAILED_BUILDS=true — preserving failed build at: ${buildDir}`);
  } else {
    cleanupBuild(buildDir);
  }
  const err = new Error(`build pipeline exhausted ${MAX_ITERATIONS} iterations without a passing build`);
  err.lastFailure = lastAttempt
    ? `${lastAttempt.phase}: ${lastAttempt.message}`
    : null;
  err.lastAttempt = lastAttempt;
  // failedBuildDir and lastAttempt are emitted so the route can persist them for resume
  onEvent({
    type: 'error',
    message: err.message,
    lastAttempt,
    failedBuildDir,
    failedBuildSessionId: buildSessionId,
  });
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
