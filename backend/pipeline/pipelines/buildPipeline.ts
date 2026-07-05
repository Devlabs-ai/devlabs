'use strict';

/**
 * Build pipeline orchestrator — author loop: CODE → SPIN → VALIDATE (max 2 iterations).
 *
 * Agents:
 *   codeAgent       — scaffold/repair sandbox files
 *   spinAgent       — docker compose up + wait for readyServices
 *   validationAgent — run validationSpec.steps + LLM judge
 *
 * Helpers: lessonStore (retry hints), spinFailureLogs (SPIN failure persistence)
 */

import type { ChallengeDraft, BuildEventHandler, ValidationResult, PortMap, BuildAttempt, BuildPhase, LessonsBlock, LessonAnchorFailure } from '../../types/domain';

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { assertLlmConfigured } = require('../helpers/agentRuntime');
const { assertCodeHarnessConfigured } = require('../helpers/codeAgentHarness');
const codeAgent = require('../agents/codeAgent');
const spinAgent = require('../agents/spinAgent');
const { SpinError } = spinAgent;
const composeManager = require('../../sandbox/composeManager');
const portAllocator = require('../../sandbox/portAllocator');
const validationAgent = require('../agents/validationAgent');
const lessonStore = require('../stores/lessonStore');
const { normalizeDraft, isDraftReady } = require('../draft/draftSchema');
const { emitLog } = require('../build/buildLogger');
const { recordBuildFailure } = require('../build/buildFailureRecord');
const { createBuildLifecycleLogger, BUILD_LIFECYCLE_FILE } = require('../build/buildLifecycleLog');
const { buildIterationChecklist } = require('../validation/validationChecklist');
const { BUILDS_ROOT } = require('../../sandbox/paths');
const { createUsageAccumulator } = require('../../llm/usage');
const { formatCostUsd } = require('../../llm/cost');
const {
  prepareSpinFailureContext,
  spinFailureForRepair,
} = require('../helpers/spinFailureLogs');
const { cloneAssets, diffAssets } = require('../helpers/assetDiff');
const { loadLatestBuildFailure } = require('../build/buildFailureRecord');
const { isActionableRepairFailure } = require('../helpers/repairAttempt');

const MAX_ITERATIONS = 2;

/** Truncate log/detail strings. */
function cap(s: unknown, max: number): string | null | undefined {
  if (!s) return s as string | null | undefined;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated ${str.length - max} chars]`;
}

/** Category string used for lesson store lookups. */
function pickCategory(draft: ChallengeDraft): string | null {
  const n = normalizeDraft(draft);
  return n.meta?.category || n.category || (n.sandboxSpec as Record<string, unknown>)?.category as string || null;
}

interface FailureSnapshot {
  attempt: number;
  phase: string;
  message: string | null;
  composeSnippet?: string | null;
  failureKind?: string | null;
  psSnapshot?: string | null;
  feedback?: string | null;
  suggestions?: string[];
  extractedErrors?: string[];
}

type BuildAssets = ReturnType<typeof codeAgent.loadAssetsFromBuildDir>;

interface PhaseLessonWindow {
  anchorFailure: LessonAnchorFailure | null;
  baselineAssets: BuildAssets;
}

/** Read a short docker-compose snippet for failure snapshots. */
function readComposeSnippet(buildDir: string | null): string | null {
  if (!buildDir) return null;
  try {
    const p = path.join(buildDir, 'docker-compose.yml');
    if (!fs.existsSync(p)) return null;
    return cap(fs.readFileSync(p, 'utf8'), 1200) || null;
  } catch (_e) {
    return null;
  }
}

/** Capture a compact record of a failed phase for fix-lesson recording. */
function captureFailureSnapshot({
  attempt,
  phase,
  lastAttempt,
  buildDir,
}: {
  attempt: number;
  phase: string;
  lastAttempt: BuildAttempt | null;
  buildDir?: string | null;
}): FailureSnapshot | null {
  if (!lastAttempt) return null;
  const d = lastAttempt.details as Record<string, unknown> | null | undefined;
  const suggestions = Array.isArray(d?.suggestions)
    ? (d.suggestions as string[]).slice(0, 8)
    : undefined;
  const extractedErrors = Array.isArray(d?.extractedErrors)
    ? (d.extractedErrors as string[]).slice(0, 12)
    : undefined;
  return {
    attempt,
    phase,
    message: cap(lastAttempt.message || '', 600) || null,
    composeSnippet: readComposeSnippet(buildDir || null),
    failureKind: typeof d?.failureKind === 'string' ? d.failureKind : null,
    psSnapshot: cap(d?.psSnapshot, 600) || null,
    feedback: cap(d?.feedback, 400) || null,
    suggestions,
    extractedErrors,
  };
}

/** Set anchor + baseline on first failure in a SPIN/VALIDATE lesson window. */
function ensurePhaseLessonAnchor(
  window: PhaseLessonWindow,
  snap: FailureSnapshot,
  assets: BuildAssets,
): void {
  if (window.anchorFailure) return;
  window.anchorFailure = {
    attempt: snap.attempt,
    phase: snap.phase,
    message: snap.message,
    failureKind: snap.failureKind,
    psSnapshot: snap.psSnapshot,
    feedback: snap.feedback,
    suggestions: snap.suggestions,
    extractedErrors: snap.extractedErrors,
  };
  window.baselineAssets = assets ? cloneAssets(assets) : null;
}

function clearPhaseLessonWindow(window: PhaseLessonWindow): void {
  window.anchorFailure = null;
  window.baselineAssets = null;
}

/** Record a fix-lesson after phase success when an anchor failure exists in the window. */
async function recordPhaseLesson({
  window,
  phase,
  assets,
  draftSessionId,
  buildSessionId,
  category,
  title,
  onEvent,
}: {
  window: PhaseLessonWindow;
  phase: 'spin' | 'validate';
  assets: BuildAssets;
  draftSessionId: string;
  buildSessionId: string;
  category: string | null;
  title: string | null | undefined;
  onEvent: BuildEventHandler;
}): Promise<number | null> {
  if (!window.anchorFailure) return null;
  const anchorAttempt = window.anchorFailure.attempt;
  const cumulativeDiff = diffAssets(window.baselineAssets, assets);
  const lessonId = await lessonStore.record({
    phase,
    draftSessionId,
    buildSessionId,
    category,
    title: title || null,
    anchorFailure: window.anchorFailure,
    cumulativeDiff: cumulativeDiff || null,
  });
  clearPhaseLessonWindow(window);
  if (lessonId) {
    const label = phase === 'spin' ? 'SPIN' : 'VALIDATE';
    emitLog(onEvent, {
      level: 'info',
      tag: 'lessons',
      message: `Recorded ${label} fix-lesson #${lessonId as number}`,
      detail: `Anchor attempt ${anchorAttempt}; diff ${cumulativeDiff.length} chars`,
    });
  }
  return lessonId;
}

interface IterationSummaryArgs {
  attempt: number;
  total: number;
  failedPhase?: string | null;
  validation?: Partial<ValidationResult> | null;
  draft?: ChallengeDraft | null;
  validationSpec?: unknown;
  cost?: { totalUsd: number; inputTokens: number; outputTokens: number } | null;
}

/** Emit iteration summary + checklist to the build UI. */
function emitIterationSummary(onEvent: BuildEventHandler, args: IterationSummaryArgs): void {
  const { attempt, total, failedPhase, validation, draft, validationSpec, cost = null } = args;
  const checklist = buildIterationChecklist({
    attempt,
    total,
    failedPhase,
    validation,
    draft,
    validationSpec,
    cost,
  });
  const phaseLines = (checklist.phases as Array<{ status: string; label: string }>).map((p) => {
    const icon = p.status === 'pass' ? '✓' : p.status === 'fail' ? '✗' : '○';
    return `${icon} ${p.label}`;
  });
  const checkLines = (checklist.items as Array<{ status: string; label: string }>).map((i) => {
    const icon = i.status === 'pass' ? '✓' : i.status === 'fail' ? '✗' : i.status === 'skip' ? '–' : '○';
    return `${icon} ${i.label}`;
  });
  const costLine = checklist.cost
    ? `Est. LLM cost: ${formatCostUsd(checklist.cost.totalUsd)} (${checklist.cost.inputTokens.toLocaleString()} in / ${checklist.cost.outputTokens.toLocaleString()} out tokens)`
    : null;
  emitLog(onEvent, {
    level: checklist.passed ? 'ok' : (failedPhase ? 'warn' : 'info'),
    tag: 'build',
    message: checklist.passed
      ? `Iteration ${attempt}/${total} — validation passed`
      : `Iteration ${attempt}/${total} — ${failedPhase || 'pipeline'} did not complete`,
    detail: [
      ...phaseLines,
      ...(costLine ? ['', costLine] : []),
      ...(checkLines.length ? ['', 'Validation checks:', ...checkLines] : []),
    ].join('\n'),
  });
  onEvent({ type: 'checklist', checklist } as never);
}

/** Persist phase/message under sandbox/builds/<id>/.devlabs/errors/ for retry. */
function persistBuildFailure(
  buildDir: string | null | undefined,
  args: {
    draftSessionId: string;
    buildSessionId: string;
    reason: 'iteration' | 'pipeline';
    lastAttempt: BuildAttempt;
    attempt: number;
  },
): void {
  if (!buildDir) return;
  recordBuildFailure(buildDir, {
    recordedAt: Date.now(),
    draftSessionId: args.draftSessionId,
    buildSessionId: args.buildSessionId,
    reason: args.reason,
    phase: args.lastAttempt.phase || null,
    message: args.lastAttempt.message || null,
    detail: args.lastAttempt.details ?? null,
    iteration: args.attempt,
    buildStatus: 'failed',
  });
}

/** Remove a build workspace directory from disk. */
function cleanupBuild(buildDir: string): void {
  try {
    fs.rmSync(buildDir, { recursive: true, force: true });
  } catch (e) {
    console.warn(`[build] cleanup failed for ${buildDir}: ${(e as Error).message}`);
  }
}

/** Map legacy phase names (GENERATE/WRITE) to CODE for resume. */
function normalizeResumePhase(phase: string | null | undefined): string | null {
  if (!phase) return null;
  const upper = phase.toUpperCase();
  if (upper === 'GENERATE' || upper === 'WRITE' || upper === 'CODE') return 'CODE';
  return upper;
}

/** Build previousAttempt for cross-request resume from disk or stored phase/message. */
function initResumePreviousAttempt({
  hasResumeDir,
  buildDir,
  resumePhase,
  resumeFailureMsg,
}: {
  hasResumeDir: boolean;
  buildDir: string;
  resumePhase: string | null;
  resumeFailureMsg: unknown;
}): BuildAttempt | null {
  if (hasResumeDir && buildDir) {
    const rec = loadLatestBuildFailure(buildDir);
    if (rec?.phase) {
      return {
        phase: rec.phase,
        message: rec.message || '',
        artifacts: null,
        rawText: null,
        details: rec.detail && typeof rec.detail === 'object'
          ? rec.detail as Record<string, unknown>
          : null,
      };
    }
  }
  if (!resumePhase || resumeFailureMsg == null) return null;
  const phase = normalizeResumePhase(resumePhase);
  if (!phase) return null;
  if (typeof resumeFailureMsg === 'object' && resumeFailureMsg !== null) {
    const obj = resumeFailureMsg as Record<string, unknown>;
    return {
      phase,
      message: String(obj.message || resumeFailureMsg),
      artifacts: null,
      rawText: null,
      details: obj,
    };
  }
  return {
    phase,
    message: String(resumeFailureMsg),
    artifacts: null,
    rawText: null,
    details: { message: resumeFailureMsg },
  };
}

/**
 * Main build loop — up to MAX_ITERATIONS of CODE → SPIN → VALIDATE.
 * Returns on first passing VALIDATE; throws after exhausting retries.
 */
async function runBuildLoop({
  draft,
  draftSessionId,
  onEvent,
  terminalWsBase = null,
  resumeBuildDir = null,
  resumeFailurePhase = null,
  resumeFailureMsg = null,
}: {
  draft: ChallengeDraft;
  draftSessionId: string;
  onEvent: BuildEventHandler;
  terminalWsBase?: string | null;
  resumeBuildDir?: string | null;
  resumeFailurePhase?: string | null;
  resumeFailureMsg?: unknown;
}): Promise<{
  buildSessionId: string;
  buildDir: string;
  builtChallenge: Record<string, unknown>;
  buildValidation: ValidationResult;
  draft: ChallengeDraft;
  portMap: PortMap;
  terminalService: string | null;
  attempts: number;
}> {
  try {
    assertCodeHarnessConfigured();
  } catch (e) {
    onEvent({ type: 'error', message: (e as Error).message } as never);
    throw e;
  }

  const normalized = normalizeDraft(draft);
  if (!isDraftReady(normalized)) {
    const e = new Error('draft is incomplete; need description, brokenState.rootCause, and infra.services') as Error;
    onEvent({ type: 'error', message: e.message } as never);
    throw e;
  }

  const serviceSummary = (normalized.infra?.services || [])
    .map((s: unknown) => {
      const svc = s as Record<string, string>;
      return `${svc.name} (${svc.image_hint || 'no image'})`;
    })
    .join(', ');

  fs.mkdirSync(BUILDS_ROOT, { recursive: true });

  // --- Build workspace: fresh folder vs resume after a prior failed POST /build ---
  //
  // resumeBuildDir is set by routes/problems when the user retries (buildFailedDir from
  // the draft session). It points at sandbox/builds/<buildSessionId>/ with docker-compose,
  // services/, etc. still on disk from the last run.
  //
  // hasResumeDir is true only when that path exists — if the folder was deleted we fall
  // back to a new UUID workspace. This is separate from in-loop retries (attempts 2–5
  // inside one HTTP request), which reuse buildDir without touching resumeBuildDir again.
  const hasResumeDir = !!(resumeBuildDir && fs.existsSync(resumeBuildDir));
  const normalizedResumePhase = normalizeResumePhase(resumeFailurePhase);

  let buildSessionId: string;
  let buildDir: string;
  if (hasResumeDir) {
    // Cross-request retry: keep the same buildSessionId (folder basename) and files.
    buildDir = resumeBuildDir!;
    buildSessionId = path.basename(buildDir);
  } else {
    buildSessionId = uuidv4();
    buildDir = path.join(BUILDS_ROOT, buildSessionId);
    fs.mkdirSync(buildDir, { recursive: true });
  }

  console.log(
    `[build] started draftSessionId=${draftSessionId} buildSessionId=${buildSessionId} buildDir=${buildDir}`,
  );

  const lifecycle = createBuildLifecycleLogger(buildDir, {
    draftSessionId,
    buildSessionId,
    resumed: hasResumeDir,
  });
  const emitEvent: BuildEventHandler = (ev) => {
    lifecycle.append(ev);
    onEvent(ev);
  };

  if (!hasResumeDir && resumeBuildDir) {
    emitLog(emitEvent, {
      level: 'warn',
      tag: 'build',
      message: 'Prior build workspace missing on disk — starting a fresh build folder',
      detail: resumeBuildDir,
    });
  }

  emitLog(emitEvent, {
    level: 'info',
    tag: 'build',
    message: hasResumeDir
      ? `Retrying build in same workspace after ${normalizedResumePhase || 'pipeline'} failure (max ${MAX_ITERATIONS} iterations)`
      : `Starting build pipeline (max ${MAX_ITERATIONS} iterations)`,
    detail: { buildDir, lifecycleLog: BUILD_LIFECYCLE_FILE },
  });

  let lastAttempt: BuildAttempt | null = initResumePreviousAttempt({
    hasResumeDir,
    buildDir,
    resumePhase: normalizedResumePhase,
    resumeFailureMsg,
  });
  let assets: ReturnType<typeof codeAgent.loadAssetsFromBuildDir> = null;

  const buildCategory = pickCategory(normalized);
  const spinLessonWindow: PhaseLessonWindow = { anchorFailure: null, baselineAssets: null };
  const validateLessonWindow: PhaseLessonWindow = { anchorFailure: null, baselineAssets: null };

  for (let attempt = 1; attempt <= MAX_ITERATIONS; attempt++) {
    const attemptCost = createUsageAccumulator();
    emitEvent({ type: 'phase', phase: 'CODE' as BuildPhase, attempt, total: MAX_ITERATIONS } as never);

    const priorFailurePhase = lastAttempt?.phase || null;
    emitLog(emitEvent, {
      level: 'phase',
      tag: 'build',
      message: priorFailurePhase
        ? `Iteration ${attempt}/${MAX_ITERATIONS} — retry after ${priorFailurePhase} failure`
        : `Iteration ${attempt}/${MAX_ITERATIONS}`,
    });

    if (attempt === 1) {
      if (hasResumeDir) {
        emitLog(emitEvent, {
          level: 'info',
          tag: 'code',
          message: 'Reusing prior failed build workspace (in-place retry)',
          detail: { buildDir, buildSessionId },
        });
      }
      emitEvent({ type: 'buildDir', buildDir } as never);
      emitLog(emitEvent, {
        level: 'info',
        tag: 'code',
        message: `Build workspace ready`,
        detail: { buildDir, buildSessionId },
      });
      console.log(`[build] CODE workspace ${buildDir} (session ${buildSessionId})`);
    }

    // Heuristic: docker-compose.yml means CODE already ran. Iteration 2+ switches to repair.
    // Longer term this may be too narrow — other scaffold files (challenge.json, services/*,
    // init/*) can be missing or corrupt while compose still exists; we may need richer checks
    // or fall back to scaffold when the workspace is incomplete.
    const hasScaffoldArtifacts = fs.existsSync(path.join(buildDir, 'docker-compose.yml'));

    let codeMode: 'scaffold' | 'repair' = 'scaffold';
    if (lastAttempt || (hasScaffoldArtifacts && attempt > 1)) {
      codeMode = 'repair';
    }

    try {
      let lessonsBlock: LessonsBlock = { relatedLessons: [] };
      if (lastAttempt && isActionableRepairFailure(lastAttempt)) {
        lessonsBlock = await lessonStore.findForRetry({
          draft: normalized,
          previousAttempt: lastAttempt,
        });
        if (lessonsBlock.relatedLessons.length) {
          const best = lessonsBlock.relatedLessons[0];
          emitLog(emitEvent, {
            level: 'info',
            tag: 'lessons',
            message: `Injecting ${lessonsBlock.relatedLessons.length} lesson(s) (retry)`,
            detail: `Top match similarity ${best.similarity != null ? best.similarity.toFixed(2) : 'n/a'} (${best.phase || 'unknown'})`,
          });
        }
      }

      emitLog(emitEvent, {
        level: 'info',
        tag: 'code',
        message: `Calling code agent (${codeMode} mode)`,
        detail: codeAgent.summariseBuildDir(buildDir) || { services: serviceSummary },
      });

      const codeResult = await codeAgent.runCodePhase({
        mode: codeMode,
        draft: normalized,
        buildDir,
        buildSessionId,
        draftSessionId,
        attempt,
        lessonsBlock,
        previousAttempt: codeMode === 'repair' ? lastAttempt : null,
        onEvent: emitEvent,
      });

      assets = codeResult.assets;
      for (const usage of codeResult.llmUsages || [codeResult.llmUsage]) {
        if (usage) attemptCost.add(usage);
      }

      // Code-chunk indexing after CODE used to run here; removed.

      emitEvent({ type: 'buildDir', buildDir } as never);
      emitLog(emitEvent, {
        level: 'ok',
        tag: 'code',
        message: 'CODE phase complete',
        detail: {
          ...codeAgent.summariseAssets(assets),
          steps: codeResult.llmUsage.stepCount,
          summary: cap(codeResult.summary, 400),
        },
      });
    } catch (e) {
      emitLog(emitEvent, { level: 'error', tag: 'code', message: (e as Error).message });
      lastAttempt = {
        phase: 'CODE',
        message: (e as Error).message,
        artifacts: assets,
        rawText: null,
        details: { message: (e as Error).message },
      };
      emitIterationSummary(emitEvent, {
        attempt,
        total: MAX_ITERATIONS,
        failedPhase: 'CODE',
        validation: null,
        draft: normalized,
        validationSpec: assets?.validationSpec,
        cost: attemptCost.isEmpty() ? null : attemptCost.summary(),
      });
      persistBuildFailure(buildDir, {
        draftSessionId,
        buildSessionId,
        reason: 'iteration',
        lastAttempt,
        attempt,
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    emitEvent({ type: 'phase', phase: 'SPIN' as BuildPhase, attempt, total: MAX_ITERATIONS } as never);
    let portMap: PortMap | null = null;
    try {
      ({ portMap } = await spinAgent.spin({
        buildDir,
        buildSessionId,
        onEvent: emitEvent,
        readyServices: assets?.validationSpec?.readyServices as string[] | null || null,
      }));

      lastAttempt = null;
      await recordPhaseLesson({
        window: spinLessonWindow,
        phase: 'spin',
        assets,
        draftSessionId,
        buildSessionId,
        category: buildCategory,
        title: normalized.meta?.name || normalized.title || assets?.title,
        onEvent: emitEvent,
      });
    } catch (e) {
      const input = e instanceof SpinError
        ? e.evidence
        : {
          failureKind: 'COMPOSE_UP' as const,
          message: String((e as Error).message || 'SPIN failed'),
        };
      const failureCtx = prepareSpinFailureContext(buildDir, input);
      const repairSpin = spinFailureForRepair(failureCtx);
      emitLog(emitEvent, {
        level: 'info',
        tag: 'spin',
        message: `SPIN failure (${failureCtx.failureKind}) — logs saved, errors extracted for repair`,
        detail: {
          failureKind: failureCtx.failureKind,
          logFile: failureCtx.logFile,
          psFile: failureCtx.psFile || null,
          logBytes: failureCtx.logBytes,
          logLineCount: failureCtx.logLineCount,
          extractedErrorCount: failureCtx.extractedErrors.length,
          extractedErrors: failureCtx.extractedErrors.slice(0, 8),
        },
      });
      lastAttempt = {
        phase: 'SPIN',
        message: failureCtx.message || input.message || 'SPIN failed',
        artifacts: assets,
        rawText: null,
        details: {
          ...repairSpin,
          extractedErrors: failureCtx.extractedErrors,
        },
      };
      const snap = captureFailureSnapshot({ attempt, phase: 'SPIN', lastAttempt, buildDir });
      if (snap) ensurePhaseLessonAnchor(spinLessonWindow, snap, assets);
      emitIterationSummary(emitEvent, {
        attempt,
        total: MAX_ITERATIONS,
        failedPhase: 'SPIN',
        validation: null,
        draft: normalized,
        validationSpec: assets?.validationSpec,
        cost: attemptCost.isEmpty() ? null : attemptCost.summary(),
      });
      persistBuildFailure(buildDir, {
        draftSessionId,
        buildSessionId,
        reason: 'iteration',
        lastAttempt,
        attempt,
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    emitEvent({ type: 'phase', phase: 'VALIDATE' as BuildPhase, attempt, total: MAX_ITERATIONS } as never);
    let validation: (ValidationResult & { llmUsage?: unknown }) | null = null;
    try {
      const validationResult = await validationAgent.validate({
        buildDir,
        portMap: portMap!,
        sandboxSpec: normalized.sandboxSpec,
        draft: normalized,
        validationSpec: assets!.validationSpec,
        onLog: (payload: string | Record<string, unknown>) => {
          if (typeof payload === 'string') {
            emitLog(emitEvent, { level: 'info', tag: 'validate', message: payload });
          } else if ((payload as Record<string, unknown>)?.type) {
            emitEvent(payload as never);
          } else {
            emitLog(emitEvent, { tag: 'validate', ...(payload as Record<string, unknown>) } as { level?: string; tag?: string; message: string; detail?: unknown });
          }
        },
      });
      validation = validationResult;
      if (validationResult.llmUsage) attemptCost.add(validationResult.llmUsage);
      emitEvent({ type: 'validation', result: validationResult } as never);
    } catch (e) {
      emitLog(emitEvent, { level: 'error', tag: 'validate', message: (e as Error).message });
      await composeManager.down(buildDir).catch(() => {});
      await portAllocator.releaseIn('build', buildSessionId).catch(() => {});
      lastAttempt = {
        phase: 'VALIDATE',
        message: (e as Error).message,
        artifacts: assets,
        rawText: null,
        details: null,
      };
      const snap = captureFailureSnapshot({ attempt, phase: 'VALIDATE', lastAttempt, buildDir });
      if (snap) ensurePhaseLessonAnchor(validateLessonWindow, snap, assets);
      emitIterationSummary(emitEvent, {
        attempt,
        total: MAX_ITERATIONS,
        failedPhase: 'VALIDATE',
        validation: { passed: false, feedback: (e as Error).message, evidence: [], checklist: [] },
        draft: normalized,
        validationSpec: assets?.validationSpec,
        cost: attemptCost.isEmpty() ? null : attemptCost.summary(),
      });
      persistBuildFailure(buildDir, {
        draftSessionId,
        buildSessionId,
        reason: 'iteration',
        lastAttempt,
        attempt,
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    if (!validation) {
      // eslint-disable-next-line no-continue
      continue;
    }

    emitIterationSummary(emitEvent, {
      attempt,
      total: MAX_ITERATIONS,
      failedPhase: validation.passed ? null : 'VALIDATE',
      validation,
      draft: normalized,
      validationSpec: assets?.validationSpec,
      cost: attemptCost.isEmpty() ? null : attemptCost.summary(),
    });

    if (validation.passed) {
      const challengeRaw = JSON.parse(fs.readFileSync(path.join(buildDir, 'challenge.json'), 'utf8'));
      const built: Record<string, unknown> = {
        ...challengeRaw,
        buildSessionId,
        buildDir,
        portMap: portMap!,
      };
      const terminalService: string | null = assets!.validationSpec?.terminalService as string | null
        || (composeManager.extractServiceNames(fs.readFileSync(path.join(buildDir, 'docker-compose.yml'), 'utf8'))[0] || null);

      const terminalWsUrl = terminalWsBase
        ? `${terminalWsBase}/ws/terminal?sessionId=__build:${buildSessionId}&container=${encodeURIComponent(terminalService || '')}`
        : null;
      const metricsWsUrl = terminalWsBase
        ? `${terminalWsBase}/ws/metrics?sessionId=__build:${buildSessionId}`
        : null;

      lastAttempt = null;
      await recordPhaseLesson({
        window: validateLessonWindow,
        phase: 'validate',
        assets,
        draftSessionId,
        buildSessionId,
        category: buildCategory,
        title: normalized.meta?.name || normalized.title || assets?.title,
        onEvent: emitEvent,
      });

      built.metrics = normalized.metrics;
      built.description = normalized.description;
      built.arch = normalized.arch;
      built.meta = normalized.meta;

      emitLog(emitEvent, {
        level: 'ok',
        tag: 'spin',
        message: 'Validation passed — bringing down build compose stack',
      });
      await composeManager.down(buildDir).catch(() => {});
      await portAllocator.releaseIn('build', buildSessionId).catch(() => {});

      emitEvent({
        type: 'done',
        buildSessionId,
        builtChallenge: built,
        buildValidation: validation,
        terminalWsUrl,
        metricsWsUrl,
      } as never);
      lifecycle.finish({
        status: 'success',
        attempts: attempt,
        buildSessionId,
      });
      return {
        buildSessionId,
        buildDir,
        builtChallenge: built,
        buildValidation: validation,
        draft: normalized,
        portMap: portMap!,
        terminalService,
        attempts: attempt,
      };
    }

    await composeManager.down(buildDir).catch(() => {});
    await portAllocator.releaseIn('build', buildSessionId).catch(() => {});
    const validateMessage = validation.feedback || 'validation rejected the build';
    const cappedEvidence = (validation.evidence || []).map((ev) => {
      const e = ev as Record<string, unknown>;
      return {
        step: e.step,
        ok: e.ok,
        label: e.label,
        statusCode: e.statusCode,
        body: cap(e.body, 500),
        stdout: cap(e.stdout, 1500),
        stderr: cap(e.stderr, 800),
        error: e.error,
      };
    });
    lastAttempt = {
      phase: 'VALIDATE',
      message: validateMessage,
      artifacts: assets,
      rawText: null,
      details: {
        feedback: validation.feedback,
        suggestions: validation.suggestions || [],
        evidence: cappedEvidence,
      },
    };
    const snap = captureFailureSnapshot({ attempt, phase: 'VALIDATE', lastAttempt, buildDir });
    if (snap) ensurePhaseLessonAnchor(validateLessonWindow, snap, assets);
    persistBuildFailure(buildDir, {
      draftSessionId,
      buildSessionId,
      reason: 'iteration',
      lastAttempt,
      attempt,
    });
  }

  await composeManager.down(buildDir).catch(() => {});
  await portAllocator.releaseIn('build', buildSessionId).catch(() => {});
  const failedBuildDir = buildDir;
  console.warn(`[build] preserving failed build for retry: ${buildDir}`);
  const err = new Error(`build pipeline exhausted ${MAX_ITERATIONS} iterations without a passing build`) as Error & {
    lastFailure?: string | null;
    lastAttempt?: BuildAttempt | null;
  };
  err.lastFailure = lastAttempt
    ? `${lastAttempt.phase}: ${lastAttempt.message}`
    : null;
  err.lastAttempt = lastAttempt;
  persistBuildFailure(failedBuildDir, {
    draftSessionId,
    buildSessionId,
    reason: 'pipeline',
    lastAttempt: lastAttempt || { phase: 'VALIDATE', message: err.message },
    attempt: MAX_ITERATIONS,
  });
  emitEvent({
    type: 'error',
    message: err.message,
    lastAttempt,
    failedBuildDir,
    failedBuildSessionId: buildSessionId,
  } as never);
  lifecycle.finish({
    status: 'exhausted',
    attempts: MAX_ITERATIONS,
    buildSessionId,
    lastPhase: lastAttempt?.phase || null,
    lastMessage: lastAttempt?.message || null,
  });
  throw err;
}

/** Tear down compose, release ports, and delete the build workspace. */
async function teardownBuild(buildSessionId: string, buildDir: string | null): Promise<void> {
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
  loadAssetsFromBuildDir: codeAgent.loadAssetsFromBuildDir,
};
