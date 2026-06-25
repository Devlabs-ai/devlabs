'use strict';

/**
 * CODE agent — Phase 1 of the build pipeline.
 *
 * Runs an LLM tool loop to scaffold or repair files under sandbox/builds/<id>/,
 * then verifies layout + validationSpec with buildVerification.
 *
 * Flow: prompt → runAgentWithTools → verifyBuildComplete → loadAssetsFromBuildDir
 */

import * as fs from 'fs';
import * as path from 'path';

import type { ChallengeDraft, BuildAttempt, BuildEventHandler, LessonsBlock } from '../../types/domain';

const { modelIdFor, providerOf } = require('../../llm/models');
const { estimateCostUsd } = require('../../llm/cost');
const { runAgentWithTools } = require('../helpers/agentRuntime');
const { createCodeAgentTools } = require('./codeAgentTools');
const {
  SYSTEM_PROMPT_STATIC,
  SYSTEM_PROMPT_DYNAMIC,
  SCAFFOLD_USER_HINT,
  REPAIR_USER_HINT,
} = require('../prompts/codeAgent.prompt');
const { verifyBuildComplete } = require('../validation/buildVerification');
const { cloneAssets, diffAssets } = require('../helpers/assetDiff');
const { buildWorkspaceTree, buildFailureContext } = require('../helpers/workspaceTree');

const MAX_STEPS_SCAFFOLD = 20;
const MAX_STEPS_REPAIR = 15;
/** Stop repair loops that only read/grep without ever applying a fix. */
const MAX_READ_ONLY_STEPS_BEFORE_WRITE = 8;

const READ_ONLY_TOOLS = new Set(['read_file', 'grep', 'list_files']);
const WRITE_TOOLS = new Set(['write_file', 'write_files', 'edit_file']);

function scaffoldCoreFilesExist(buildDir: string): boolean {
  return fs.existsSync(path.join(buildDir, 'docker-compose.yml'))
    && fs.existsSync(path.join(buildDir, 'challenge.json'));
}

/** Stop scaffold loops that devolve into grep/read self-verification after files exist. */
function createScaffoldEarlyStop(buildDir: string): {
  shouldContinue: (step: { toolResults: Array<{ toolName: string }> }) => boolean;
} {
  let readOnlyStreak = 0;
  return {
    shouldContinue({ toolResults }) {
      if (!scaffoldCoreFilesExist(buildDir)) return true;
      const names = toolResults.map((t) => t.toolName);
      if (names.some((n) => WRITE_TOOLS.has(n))) {
        readOnlyStreak = 0;
        return true;
      }
      if (names.length > 0 && names.every((n) => READ_ONLY_TOOLS.has(n))) {
        readOnlyStreak += 1;
      } else {
        readOnlyStreak = 0;
      }
      return readOnlyStreak < 2;
    },
  };
}

/** Stop repair loops that devolve into read-only spirals (pre- or post-write). */
function createRepairEarlyStop(): {
  shouldContinue: (step: { toolResults: Array<{ toolName: string; output?: unknown }> }) => boolean;
  stopReason: () => 'pre_write' | 'post_write' | null;
} {
  let hasWritten = false;
  let readOnlyStreakAfterWrite = 0;
  let readOnlyStreakBeforeWrite = 0;
  let lastStopReason: 'pre_write' | 'post_write' | null = null;
  return {
    stopReason: () => lastStopReason,
    shouldContinue({ toolResults }) {
      lastStopReason = null;
      const names = toolResults.map((t) => t.toolName);
      const readOnly = names.length > 0 && names.every((n) => READ_ONLY_TOOLS.has(n));

      if (toolResults.some((tr) => isSuccessfulWrite(tr))) {
        hasWritten = true;
        readOnlyStreakAfterWrite = 0;
        readOnlyStreakBeforeWrite = 0;
        return true;
      }

      if (!hasWritten) {
        if (readOnly) readOnlyStreakBeforeWrite += 1;
        else readOnlyStreakBeforeWrite = 0;
        if (readOnlyStreakBeforeWrite >= MAX_READ_ONLY_STEPS_BEFORE_WRITE) {
          lastStopReason = 'pre_write';
          return false;
        }
        return true;
      }

      if (readOnly) readOnlyStreakAfterWrite += 1;
      else readOnlyStreakAfterWrite = 0;
      if (readOnlyStreakAfterWrite >= 2) {
        lastStopReason = 'post_write';
        return false;
      }
      return true;
    },
  };
}

function isSuccessfulWrite(tr: { toolName: string; output?: unknown }): boolean {
  if (!WRITE_TOOLS.has(tr.toolName)) return false;
  const o = tr.output as Record<string, unknown> | undefined;
  if (!o || o.error) return false;
  if (tr.toolName === 'write_files') {
    const written = o.written as unknown[] | undefined;
    return (o.count as number) > 0 || (Array.isArray(written) && written.length > 0);
  }
  return o.ok === true;
}

/** Slim draft slice shared by scaffold and repair payloads. */
function slimDraftSlice(draft: ChallengeDraft): Record<string, unknown> {
  return {
    title: draft.meta?.name || draft.title,
    category: draft.meta?.category || draft.category,
    infra: draft.infra,
    brokenState: {
      rootCause: draft.brokenState?.rootCause,
      validationSymptoms: draft.brokenState?.validationSymptoms,
    },
    sandboxSpec: draft.sandboxSpec,
  };
}
export interface ChallengeAssets {
  title?: string;
  description?: string;
  difficulty?: string;
  category?: string;
  tags?: string[];
  dockerCompose?: string;
  services?: Record<string, Record<string, string>>;
  initFiles?: Record<string, string>;
  validationSpec?: Record<string, unknown>;
  problemStatement?: Record<string, unknown> | string | null;
  id?: string | null;
}

/** Truncate long strings for repair payloads and logs. */
function cap(s: unknown, max: number): string | null | undefined {
  if (!s) return s as string | null | undefined;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated ${str.length - max} chars]`;
}

/** Strip bulky fields from a prior CODE attempt before sending to the LLM. */
function sanitizePreviousAttempt(prev: BuildAttempt | null | undefined): BuildAttempt | null {
  if (!prev) return null;
  const out: BuildAttempt = {
    phase: prev.phase,
    message: prev.message,
    artifacts: null,
    rawText: cap(prev.rawText, 2000) || null,
    details: null,
  };
  if (prev.details) {
    const d = prev.details as Record<string, unknown>;
    out.details = { message: d.message || prev.message };
  }
  return out;
}

/**
 * Build the JSON user payload for the CODE agent.
 * Scaffold sends a slim draft; repair includes SPIN/VALIDATE failure signals.
 */
function buildCodeUserPayload({
  mode,
  draft,
  buildDir,
  lessonsBlock,
  spinFailureMsg,
  validateFailureMsg,
  previousAttempt,
}: {
  mode: 'scaffold' | 'repair';
  draft: ChallengeDraft;
  buildDir?: string;
  lessonsBlock: LessonsBlock;
  spinFailureMsg?: Record<string, unknown> | null;
  validateFailureMsg?: Record<string, unknown> | null;
  previousAttempt?: BuildAttempt | null;
}): Record<string, unknown> {
  const slimDraft = slimDraftSlice(draft);
  if (mode === 'scaffold') {
    return {
      mode,
      draft: slimDraft,
      lessonsBlock,
    };
  }

  const workspaceTree = buildDir ? buildWorkspaceTree(buildDir, draft) : null;
  const sanitizedPrev = sanitizePreviousAttempt(previousAttempt);
  const failureContext = buildFailureContext({
    spinFailureMsg,
    validateFailureMsg,
    previousAttempt: sanitizedPrev,
    workspaceTree,
  });

  const payload: Record<string, unknown> = {
    mode,
    draft: slimDraft,
    workspaceTree,
    lessonsBlock,
    spinFailureMsg,
    validateFailureMsg,
    previousAttempt: sanitizedPrev,
  };
  if (failureContext) payload.failureContext = failureContext;
  return payload;
}

/** Compact summary of loaded assets for build logs. */
function summariseAssets(assets: ChallengeAssets | null | undefined): Record<string, unknown> | null {
  if (!assets) return null;
  return {
    title: assets.title,
    services: Object.keys(assets.services || {}),
    initFiles: Object.keys(assets.initFiles || {}),
    composeBytes: (assets.dockerCompose || '').length,
    stepCount: (assets.validationSpec as { steps?: unknown[] })?.steps?.length ?? 0,
    hasValidationSpec: !!assets.validationSpec,
  };
}

/** Summarise whatever is already on disk in the build workspace. */
function summariseBuildDir(buildDir: string): Record<string, unknown> | null {
  if (!fs.existsSync(buildDir)) return null;
  return summariseAssets(loadAssetsFromBuildDir(buildDir));
}

/**
 * Read challenge.json + docker-compose.yml and service files from a build directory.
 * Used after CODE completes and by buildPipeline for resume/repair context.
 */
function loadAssetsFromBuildDir(buildDir: string): ChallengeAssets | null {
  if (!fs.existsSync(buildDir)) return null;
  try {
    const challengePath = path.join(buildDir, 'challenge.json');
    const composePath = path.join(buildDir, 'docker-compose.yml');
    if (!fs.existsSync(challengePath) || !fs.existsSync(composePath)) return null;

    const challenge = JSON.parse(fs.readFileSync(challengePath, 'utf8'));
    const composeRaw = fs.readFileSync(composePath, 'utf8');

    const services: Record<string, Record<string, string>> = {};
    const servicesDir = path.join(buildDir, 'services');
    if (fs.existsSync(servicesDir)) {
      for (const svc of fs.readdirSync(servicesDir)) {
        const svcPath = path.join(servicesDir, svc);
        if (!fs.statSync(svcPath).isDirectory()) continue;
        services[svc] = {};
        for (const file of fs.readdirSync(svcPath)) {
          const fpath = path.join(svcPath, file);
          if (fs.statSync(fpath).isFile()) {
            services[svc][file] = fs.readFileSync(fpath, 'utf8');
          }
        }
      }
    }

    const initFiles: Record<string, string> = {};
    const initDir = path.join(buildDir, 'init');
    if (fs.existsSync(initDir)) {
      for (const file of fs.readdirSync(initDir)) {
        const fpath = path.join(initDir, file);
        if (fs.statSync(fpath).isFile()) {
          initFiles[file] = fs.readFileSync(fpath, 'utf8');
        }
      }
    }

    return {
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
    };
  } catch (e) {
    console.warn(`[codeAgent] loadAssetsFromBuildDir failed: ${(e as Error).message}`);
    return null;
  }
}

function emitCodeLog(onEvent: BuildEventHandler | undefined, message: string, detail?: unknown): void {
  onEvent?.({ type: 'log', level: 'info', tag: 'code', message, detail } as never);
  console.log(`[code] ${message}`);
}

/** Run the LLM + sandbox-tool loop for one CODE invocation. */
async function runCodeAgentLoop({
  mode,
  prompt,
  buildDir,
  maxSteps,
  onEvent,
}: {
  mode: 'scaffold' | 'repair';
  prompt: string;
  buildDir: string;
  maxSteps: number;
  onEvent?: BuildEventHandler;
}): Promise<{ summary: string; usage: Record<string, unknown> }> {
  const modelId = modelIdFor('code');
  const provider = providerOf(modelId);
  emitCodeLog(onEvent, `CODE agent (${mode}) — ${modelId}, cwd=${buildDir}`);

  const repairBaseline = mode === 'repair' ? cloneAssets(loadAssetsFromBuildDir(buildDir) || {}) : null;

  const earlyStop = mode === 'scaffold'
    ? createScaffoldEarlyStop(buildDir)
    : mode === 'repair'
      ? createRepairEarlyStop()
      : null;

  const result = await runAgentWithTools({
    agent: 'code',
    system: `${SYSTEM_PROMPT_STATIC}\n\n${SYSTEM_PROMPT_DYNAMIC}`,
    messages: [{ role: 'user', content: prompt }],
    tools: createCodeAgentTools({ buildDir, mode, onEvent }),
    maxSteps,
    maxTokens: 16384,
    onEvent,
    label: mode,
    promptCache: provider === 'anthropic',
    shouldContinue: earlyStop
      ? (step: { stepIndex: number; toolResults: Array<{ toolName: string; output?: unknown }>; text?: string }) => {
          const cont = earlyStop.shouldContinue(step);
          if (!cont) {
            if (mode === 'scaffold') {
              emitCodeLog(onEvent, 'Scaffold files present — stopping tool loop (server verification runs next)');
            } else {
              const repairStop = earlyStop as ReturnType<typeof createRepairEarlyStop>;
              const reason = repairStop.stopReason?.() ?? null;
              const msg = reason === 'pre_write'
                ? 'Repair read-only spiral — stopping tool loop (no edits applied; server verification runs next)'
                : 'Repair fix applied — stopping tool loop (server verification runs next)';
              emitCodeLog(onEvent, msg);
            }
          }
          return cont;
        }
      : undefined,
  });

  if (mode === 'repair' && repairBaseline && onEvent) {
    const afterAssets = loadAssetsFromBuildDir(buildDir);
    const summary = diffAssets(repairBaseline, afterAssets);
    if (summary) {
      onEvent({ type: 'codeDiff', tool: 'repair_summary', path: '(all changes)', diff: summary, summary: true } as never);
    }
  }

  const usage = result.usage as { inputTokens?: number; outputTokens?: number } | undefined;
  const inputTokens = usage?.inputTokens || 0;
  const outputTokens = usage?.outputTokens || 0;
  const costUsd = estimateCostUsd(modelId, usage);
  let summary = (result.text || '').trim();
  if (!summary) {
    summary = mode === 'scaffold'
      ? 'Scaffold files written — server verification runs next.'
      : 'Repair edits applied — server verification runs next.';
  }

  emitCodeLog(onEvent, `CODE agent complete — ${result.stepCount} step(s), $${costUsd.toFixed(4)}`, {
    modelId, inputTokens, outputTokens,
  });

  return {
    summary,
    usage: {
      agent: 'code',
      label: mode,
      modelId,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      stepCount: result.stepCount,
      costUsd,
    },
  };
}

/**
 * Entry point for the CODE phase — called by buildPipeline each iteration.
 */
async function runCodePhase({
  mode,
  draft,
  buildDir,
  buildSessionId: _buildSessionId,
  draftSessionId: _draftSessionId = null,
  attempt: _attempt,
  lessonsBlock = { relatedLessons: [] },
  spinFailureMsg = null,
  validateFailureMsg = null,
  previousAttempt = null,
  onEvent,
}: {
  mode: 'scaffold' | 'repair';
  draft: ChallengeDraft;
  buildDir: string;
  buildSessionId: string;
  draftSessionId?: string | null;
  attempt: number;
  lessonsBlock?: LessonsBlock;
  spinFailureMsg?: Record<string, unknown> | null;
  validateFailureMsg?: Record<string, unknown> | null;
  previousAttempt?: BuildAttempt | null;
  onEvent?: BuildEventHandler;
}): Promise<{
  summary: string;
  assets: ChallengeAssets;
  llmUsage: Record<string, unknown>;
  llmUsages: Array<Record<string, unknown>>;
}> {
  fs.mkdirSync(buildDir, { recursive: true });

  const modeHint = mode === 'scaffold' ? SCAFFOLD_USER_HINT : REPAIR_USER_HINT;
  const prompt = `${modeHint}\n\n${JSON.stringify(buildCodeUserPayload({
    mode,
    draft,
    buildDir,
    lessonsBlock,
    spinFailureMsg,
    validateFailureMsg,
    previousAttempt,
  }), null, 2)}`;

  const agentResult = await runCodeAgentLoop({
    mode,
    prompt,
    buildDir,
    maxSteps: mode === 'scaffold' ? MAX_STEPS_SCAFFOLD : MAX_STEPS_REPAIR,
    onEvent,
  });

  emitCodeLog(onEvent, 'CODE verify…');
  verifyBuildComplete(buildDir, { scaffoldRules: true });
  emitCodeLog(onEvent, 'CODE verify passed');

  const assets = loadAssetsFromBuildDir(buildDir);
  if (!assets) {
    throw new Error('CODE phase finished but challenge.json / docker-compose.yml could not be loaded');
  }

  return {
    summary: agentResult.summary,
    assets,
    llmUsage: agentResult.usage,
    llmUsages: [agentResult.usage],
  };
}

module.exports = {
  runCodePhase,
  loadAssetsFromBuildDir,
  summariseAssets,
  summariseBuildDir,
  buildCodeUserPayload,
};
