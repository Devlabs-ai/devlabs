'use strict';

/**
 * Pipeline skills for the CODE agent
 *
 * Skill selection is deterministic: buildPipeline → runCodePhase({ mode }) →
 * buildCodeAgentSystemPrompt(mode). The LLM does not pick a skill; mode is in the user payload.
 */

import * as fs from 'fs';
import * as path from 'path';

export type CodeAgentMode = 'scaffold' | 'repair';

const SKILLS_DIR = resolveSkillsDir();
const fileCache = new Map<string, string>();

function resolveSkillsDir(): string {
  const candidates = [
    path.join(__dirname, 'code-agent'),
    path.join(process.cwd(), 'pipeline', 'skills', 'code-agent'),
    path.join(process.cwd(), 'backend', 'pipeline', 'skills', 'code-agent'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'invariants.md'))) return dir;
  }
  throw new Error(
    `CODE agent skills not found — expected invariants.md under pipeline/skills/code-agent (tried: ${candidates.join(', ')})`,
  );
}

function readSkillFile(relativePath: string): string {
  const cached = fileCache.get(relativePath);
  if (cached !== undefined) return cached;
  const abs = path.join(SKILLS_DIR, relativePath);
  const text = fs.readFileSync(abs, 'utf8').trim();
  fileCache.set(relativePath, text);
  return text;
}

/** Remove optional YAML frontmatter from SKILL.md */
function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  return text.slice(end + 4).trim();
}

function loadSkill(relativePath: string): string {
  return stripFrontmatter(readSkillFile(relativePath));
}

/**
 * Compose system prompt: shared invariants + exactly one mode skill.
 */
function buildCodeAgentSystemPrompt(mode: CodeAgentMode): string {
  const invariants = loadSkill('invariants.md');
  const skillRel = mode === 'scaffold' ? 'scaffold/SKILL.md' : 'repair/SKILL.md';
  const skill = loadSkill(skillRel);
  const skillName = mode === 'scaffold' ? 'code-agent-scaffold' : 'code-agent-repair';
  const modeLabel = mode.toUpperCase();

  return [
    'You are the Code Agent for "Devlabs". You build broken-infrastructure interview sandboxes in the build workspace (`workspaceRoot` in the user JSON).',
    'Use Claude Code tools: Read, Write, Edit, Glob, Grep. Do not run shell commands — SPIN runs docker compose after you finish.',
    'All file paths must stay inside workspaceRoot — the server denies writes elsewhere.',
    '',
    '============================= ACTIVE SKILL =============================',
    `Pipeline mode: ${modeLabel} | skill: ${skillName}`,
    'The server selected this skill for the current invocation. Follow it for workflow; invariants below always apply.',
    '',
    skill,
    '',
    '============================= DEVLABS INVARIANTS (always apply) =============================',
    invariants,
  ].join('\n');
}

function clearSkillCache(): void {
  fileCache.clear();
}

module.exports = {
  buildCodeAgentSystemPrompt,
  clearSkillCache,
};
