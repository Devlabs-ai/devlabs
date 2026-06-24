'use strict';

/**
 * Diff challenge workspace assets (baseline at first phase failure → current at success).
 * Used to ground lesson fix_summary text.
 */

import type { ChallengeAssets } from '../agents/codeAgent';

const MAX_PATHS = 20;
const MAX_PER_FILE = 6000;
const MAX_TOTAL = 24000;

function capText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

/** Deep-clone assets for baseline snapshot storage. */
export function cloneAssets(assets: ChallengeAssets): ChallengeAssets {
  return JSON.parse(JSON.stringify(assets)) as ChallengeAssets;
}

/** Flatten ChallengeAssets into logical file paths → content. */
export function flattenAssetsForDiff(assets: ChallengeAssets | null | undefined): Record<string, string> {
  if (!assets) return {};
  const out: Record<string, string> = {};

  if (assets.dockerCompose != null) {
    out['docker-compose.yml'] = assets.dockerCompose;
  }

  const challengePayload = {
    title: assets.title,
    description: assets.description,
    difficulty: assets.difficulty,
    category: assets.category,
    tags: assets.tags,
    problemStatement: assets.problemStatement,
    validationSpec: assets.validationSpec,
  };
  out['challenge.json'] = JSON.stringify(challengePayload, null, 2);

  for (const [svc, files] of Object.entries(assets.services || {})) {
    for (const [file, content] of Object.entries(files)) {
      out[`services/${svc}/${file}`] = content;
    }
  }

  for (const [file, content] of Object.entries(assets.initFiles || {})) {
    out[`init/${file}`] = content;
  }

  return out;
}

function formatFileChange(path: string, before: string | undefined, after: string | undefined): string {
  if (before === after) return '';
  if (before == null && after != null) {
    return `=== ${path} (added) ===\n${capText(after, MAX_PER_FILE)}`;
  }
  if (before != null && after == null) {
    return `=== ${path} (removed) ===\n${capText(before, MAX_PER_FILE)}`;
  }
  const b = before!;
  const a = after!;
  if (b === a) return '';
  return [
    `=== ${path} (changed) ===`,
    '--- baseline ---',
    capText(b, MAX_PER_FILE),
    '+++ current +++',
    capText(a, MAX_PER_FILE),
  ].join('\n');
}

/**
 * Text diff of two asset snapshots — changed paths only, capped for LLM prompts.
 */
export function diffAssets(
  baseline: ChallengeAssets | null | undefined,
  current: ChallengeAssets | null | undefined,
): string {
  const baseFlat = flattenAssetsForDiff(baseline);
  const curFlat = flattenAssetsForDiff(current);
  const paths = [...new Set([...Object.keys(baseFlat), ...Object.keys(curFlat)])].sort();

  const chunks: string[] = [];
  let total = 0;

  for (const p of paths) {
    if (chunks.length >= MAX_PATHS) {
      chunks.push(`…[${paths.length - MAX_PATHS} more path(s) omitted]`);
      break;
    }
    const block = formatFileChange(p, baseFlat[p], curFlat[p]);
    if (!block) continue;
    if (total + block.length > MAX_TOTAL) {
      chunks.push(`…[diff truncated at ${MAX_TOTAL} chars]`);
      break;
    }
    chunks.push(block);
    total += block.length;
  }

  return chunks.join('\n\n').trim();
}

module.exports = {
  cloneAssets,
  flattenAssetsForDiff,
  diffAssets,
};
