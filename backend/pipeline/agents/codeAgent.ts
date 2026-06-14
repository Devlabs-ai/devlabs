'use strict';

// Code Agent — CODE phase of the build pipeline (tools + layout verify).

import * as fs from 'fs';
import * as path from 'path';

import type { ChallengeDraft, BuildAttempt, BuildEventHandler } from '../../types/domain';

const composeManager = require('../../sandbox/composeManager');
const { runAgentWithTools } = require('../helpers/agentRuntime');
const { SYSTEM_PROMPT, SCAFFOLD_USER_HINT, REPAIR_USER_HINT } = require('../prompts/codeAgent.prompt');
const { createCodeAgentTools } = require('./codeAgentTools');

const MAX_TOOL_STEPS_SCAFFOLD = 30;
const MAX_TOOL_STEPS_REPAIR = 20;

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

interface LessonEntry {
  text?: string;
  [key: string]: unknown;
}

interface LessonsBlock {
  relatedLessons: LessonEntry[];
}

function cap(s: unknown, max: number): string | null | undefined {
  if (!s) return s as string | null | undefined;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated ${str.length - max} chars]`;
}

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

function summariseAssets(assets: ChallengeAssets | null | undefined): Record<string, unknown> | null {
  if (!assets) return null;
  return {
    title: assets?.title,
    services: Object.keys(assets?.services || {}),
    initFiles: Object.keys(assets?.initFiles || {}),
    composeBytes: (assets?.dockerCompose || '').length,
    hasValidationSpec: !!assets?.validationSpec,
  };
}

function summariseBuildDir(buildDir: string): Record<string, unknown> | null {
  if (!fs.existsSync(buildDir)) return null;
  const assets = loadAssetsFromBuildDir(buildDir);
  return summariseAssets(assets);
}

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

function verifyBuildLayout(buildDir: string): void {
  const issues: string[] = [];
  const composePath = path.join(buildDir, 'docker-compose.yml');
  const challengePath = path.join(buildDir, 'challenge.json');

  if (!fs.existsSync(composePath)) {
    issues.push('missing docker-compose.yml');
  }
  if (!fs.existsSync(challengePath)) {
    issues.push('missing challenge.json');
  }
  if (issues.length) {
    throw new Error(`build layout incomplete: ${issues.join('; ')}`);
  }

  const composeYaml = fs.readFileSync(composePath, 'utf8');
  const buildCtxs: Array<{ service: string; contextPath: string }> = composeManager.extractBuildContexts(composeYaml);
  for (const { service, contextPath } of buildCtxs) {
    const ctxAbs = path.resolve(buildDir, contextPath);
    if (!ctxAbs.startsWith(`${buildDir}${path.sep}`) && ctxAbs !== buildDir) {
      issues.push(`service "${service}": build.context "${contextPath}" escapes the build dir`);
      continue;
    }
    if (!fs.existsSync(ctxAbs) || !fs.statSync(ctxAbs).isDirectory()) {
      issues.push(`service "${service}": build.context "${contextPath}" — directory does not exist`);
      continue;
    }
    if (!fs.existsSync(path.join(ctxAbs, 'Dockerfile'))) {
      issues.push(`service "${service}": build.context "${contextPath}" — Dockerfile missing`);
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `compose references build contexts that don't exist on disk: ${issues.join('; ')}. `
      + 'Use build.context: ./services/<service-name> for each built service.',
    );
  }
}

async function runCodePhase({
  mode,
  draft,
  buildDir,
  buildSessionId,
  draftSessionId = null,
  attempt,
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
  llmUsage: { agent: string; label: string; modelId?: string; usage?: unknown; stepCount?: number };
}> {
  fs.mkdirSync(buildDir, { recursive: true });

  const tools = createCodeAgentTools({
    buildDir,
    buildSessionId,
    draftSessionId,
    attempt,
    onEvent,
  });

  const maxSteps = mode === 'scaffold' ? MAX_TOOL_STEPS_SCAFFOLD : MAX_TOOL_STEPS_REPAIR;
  const modeHint = mode === 'scaffold' ? SCAFFOLD_USER_HINT : REPAIR_USER_HINT;

  const userPayload = JSON.stringify({
    mode,
    draft,
    lessonsBlock,
    spinFailureMsg,
    validateFailureMsg,
    previousAttempt: sanitizePreviousAttempt(previousAttempt),
  }, null, 2);

  const llmResult = await runAgentWithTools({
    agent: 'code',
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: `${modeHint}\n\n${userPayload}` },
    ],
    tools,
    maxSteps,
    maxTokens: 16384,
    onEvent,
    label: mode,
  });

  verifyBuildLayout(buildDir);

  const assets = loadAssetsFromBuildDir(buildDir);
  if (!assets) {
    throw new Error('CODE phase finished but challenge.json / docker-compose.yml could not be loaded');
  }

  return {
    summary: llmResult.text || '',
    assets,
    llmUsage: {
      agent: 'code',
      label: mode,
      modelId: llmResult.modelId,
      usage: llmResult.usage,
      stepCount: llmResult.stepCount,
    },
  };
}

module.exports = {
  SYSTEM_PROMPT,
  runCodePhase,
  loadAssetsFromBuildDir,
  verifyBuildLayout,
  summariseAssets,
  summariseBuildDir,
};
