'use strict';

/**
 * MinIO helpers for Spark authoring — challenge / authoring prefixes.
 *
 * Layout:
 *   challenges/<slug>/authoring/<draftId>/{gen,starter,solution,input,eval}/
 *   challenges/<slug>/{input,starter,eval}/   (publish destinations)
 */

import type { SparkWorkspaceLayout } from '../../types/sparkShape';

const { getObjectStore, normalizeKey } = require('../../workspace/objectStore');
const { uploadDirToPrefix } = require('./uploadDir');

function authoringStagePrefix(slug: string, draftSessionId: string): string {
  return normalizeKey(`challenges/${slug}/authoring/${draftSessionId}/`).replace(/\/?$/, '/');
}

function authoringGenPrefix(slug: string, draftSessionId: string): string {
  return `${authoringStagePrefix(slug, draftSessionId)}gen/`;
}

function authoringInputPrefix(slug: string, draftSessionId: string): string {
  return `${authoringStagePrefix(slug, draftSessionId)}input/`;
}

function authoringStarterPrefix(slug: string, draftSessionId: string): string {
  return `${authoringStagePrefix(slug, draftSessionId)}starter/`;
}

function authoringSolutionPrefix(slug: string, draftSessionId: string): string {
  return `${authoringStagePrefix(slug, draftSessionId)}solution/`;
}

function authoringEvalPrefix(slug: string, draftSessionId: string): string {
  return `${authoringStagePrefix(slug, draftSessionId)}eval/`;
}

async function listAuthoringPrefix(prefix: string): Promise<string[]> {
  const store = getObjectStore();
  return store.listKeys(normalizeKey(prefix).replace(/\/?$/, '/'));
}

async function verifyPrefixHasObjects(
  prefix: string,
  minCount = 1,
): Promise<{ ok: boolean; count: number; sample: string[] }> {
  const keys = await listAuthoringPrefix(prefix);
  const files = keys.filter((k) => !k.endsWith('/'));
  return {
    ok: files.length >= minCount,
    count: files.length,
    sample: files.slice(0, 8),
  };
}

/** Sync local gen/starter/solution (and optional eval) into authoring MinIO prefixes. */
async function syncAuthoringAssetsToMinio({
  layout,
  slug,
  draftSessionId,
  includeEval = false,
}: {
  layout: SparkWorkspaceLayout;
  slug: string;
  draftSessionId: string;
  includeEval?: boolean;
}): Promise<{
  gen: { count: number; deleted?: number };
  starter: { count: number; deleted?: number };
  solution: { count: number; deleted?: number };
  eval?: { count: number; deleted?: number };
}> {
  const gen = await uploadDirToPrefix(layout.gen, authoringGenPrefix(slug, draftSessionId), { replace: true });
  const starter = await uploadDirToPrefix(
    layout.starter,
    authoringStarterPrefix(slug, draftSessionId),
    { replace: true },
  );
  const solution = await uploadDirToPrefix(
    layout.solution,
    authoringSolutionPrefix(slug, draftSessionId),
    { replace: true },
  );
  let evalUpload: { count: number; deleted?: number } | undefined;
  if (includeEval) {
    evalUpload = await uploadDirToPrefix(
      layout.eval,
      authoringEvalPrefix(slug, draftSessionId),
      { replace: true },
    );
  }
  return {
    gen: { count: gen.count, deleted: gen.deleted },
    starter: { count: starter.count, deleted: starter.deleted },
    solution: { count: solution.count, deleted: solution.deleted },
    eval: evalUpload,
  };
}

module.exports = {
  authoringStagePrefix,
  authoringGenPrefix,
  authoringInputPrefix,
  authoringStarterPrefix,
  authoringSolutionPrefix,
  authoringEvalPrefix,
  listAuthoringPrefix,
  verifyPrefixHasObjects,
  syncAuthoringAssetsToMinio,
};
