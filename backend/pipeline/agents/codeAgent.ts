'use strict';

/**
 * CODE agent — Phase 1 of the build pipeline.
 *
 * Runs Claude Agent SDK (Claude Code harness) to scaffold or repair files under
 * sandbox/builds/<id>/, then verifies layout + validationSpec with buildVerification.
 *
 * Flow: runCodePhase → runCodeAgent → runCodeAgentHarness → verifyBuildComplete
 */

import * as fs from 'fs';
import * as path from 'path';

import type { ChallengeDraft, BuildAttempt, BuildEventHandler, LessonsBlock } from '../../types/domain';

const { estimateCostUsd } = require('../../llm/cost');
const { runCodeAgentHarness } = require('../helpers/codeAgentHarness');
const {
  buildCodeAgentSystemPrompt,
  SCAFFOLD_USER_HINT,
  REPAIR_USER_HINT,
} = require('../skills/codeAgentSkills');
const { verifyBuildComplete } = require('../validation/buildVerification');
const { cloneAssets, diffAssets } = require('../helpers/assetDiff');
const { buildWorkspaceTree, buildFailureContext } = require('../helpers/workspaceTree');

const MAX_TURNS_SCAFFOLD = 20;
const MAX_TURNS_REPAIR = 15;

/** Slim draft slice shared by scaffold and repair payloads. */
function slimDraftSlice(draft: ChallengeDraft): Record<string, unknown> {
  return {
    title: draft.meta?.name || draft.title,
    category: draft.meta?.category || draft.category,
    infra: draft.infra,
    readyServices: draft.readyServices,
    codebase: draft.codebase,
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
    buildDir,
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

/** Run one CODE agent session (Claude Code harness + Devlabs post-processing). */
async function runCodeAgent({
  mode,
  prompt,
  buildDir,
  maxTurns,
  onEvent,
}: {
  mode: 'scaffold' | 'repair';
  prompt: string;
  buildDir: string;
  maxTurns: number;
  onEvent?: BuildEventHandler;
}): Promise<{ summary: string; usage: Record<string, unknown>; hasWritten: boolean }> {
  emitCodeLog(onEvent, `CODE agent (${mode}) — Claude Code harness, skill=code-agent-${mode}, cwd=${buildDir}`);

  const repairBaseline = mode === 'repair' ? cloneAssets(loadAssetsFromBuildDir(buildDir) || {}) : null;
  const systemPrompt = buildCodeAgentSystemPrompt(mode);

  const result = await runCodeAgentHarness({
    prompt,
    systemPrompt,
    buildDir,
    maxTurns,
    onEvent,
    label: mode,
  });

  if (mode === 'repair' && repairBaseline && onEvent) {
    const afterAssets = loadAssetsFromBuildDir(buildDir);
    const summary = diffAssets(repairBaseline, afterAssets);
    if (summary) {
      onEvent({ type: 'codeDiff', tool: 'repair_summary', path: '(all changes)', diff: summary, summary: true } as never);
    }
  }

  const { inputTokens, outputTokens, totalTokens } = result.usage;
  const costUsd = result.costUsd || estimateCostUsd(result.modelId, result.usage);
  let summary = (result.text || '').trim();
  const wrote = mode === 'scaffold' ? true : result.hasWritten;
  if (!summary) {
    summary = mode === 'scaffold'
      ? 'Scaffold files written — server verification runs next.'
      : wrote
        ? 'Repair edits applied — server verification runs next.'
        : 'Repair loop ended without file edits.';
  }

  emitCodeLog(onEvent, `CODE agent complete — ${result.stepCount} turn(s), $${costUsd.toFixed(4)}`, {
    modelId: result.modelId, inputTokens, outputTokens, hasWritten: wrote,
  });

  return {
    summary,
    hasWritten: wrote,
    usage: {
      agent: 'code',
      label: mode,
      modelId: result.modelId,
      usage: { inputTokens, outputTokens, totalTokens },
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
  const userPayload = buildCodeUserPayload({
    mode,
    draft,
    buildDir,
    lessonsBlock,
    spinFailureMsg,
    validateFailureMsg,
    previousAttempt,
  });
  const prompt = `${modeHint}\n\n${JSON.stringify(userPayload, null, 2)}`;

  const agentResult = await runCodeAgent({
    mode,
    prompt,
    buildDir,
    maxTurns: mode === 'scaffold' ? MAX_TURNS_SCAFFOLD : MAX_TURNS_REPAIR,
    onEvent,
  });

  if (
    mode === 'repair'
    && !agentResult.hasWritten
    && (validateFailureMsg || spinFailureMsg)
  ) {
    throw new Error(
      'CODE repair finished without editing any files — use Edit or Write on failureContext.likelyFiles (e.g. services/*/app.py) to fix the reported failure',
    );
  }

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
