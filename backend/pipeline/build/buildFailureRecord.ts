'use strict';

/**
 * Persist build failure context under sandbox/builds/<id>/.devlabs/errors/
 * for retry (CODE agent) and operator inspection.
 */

import * as fs from 'fs';
import * as path from 'path';

export const BUILD_ERRORS_DIR = '.devlabs/errors';

export interface BuildFailureRecord {
  recordedAt: number;
  draftSessionId?: string | null;
  buildSessionId?: string | null;
  reason: 'iteration' | 'pipeline' | 'cancel' | 'error';
  phase: string | null;
  message: string | null;
  detail?: unknown;
  iteration?: number | null;
  buildStatus?: string | null;
  lastLogs?: string[];
}

function errorsRoot(buildDir: string): string {
  return path.join(buildDir, BUILD_ERRORS_DIR);
}

function ensureErrorsDir(buildDir: string): string {
  const root = errorsRoot(buildDir);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Write latest.json plus a timestamped history file. */
export function recordBuildFailure(
  buildDir: string | null | undefined,
  record: BuildFailureRecord,
): string | null {
  if (!buildDir || !fs.existsSync(buildDir)) return null;
  try {
    const root = ensureErrorsDir(buildDir);
    const payload: BuildFailureRecord = {
      ...record,
      recordedAt: record.recordedAt || Date.now(),
    };
    const latestPath = path.join(root, 'latest.json');
    fs.writeFileSync(latestPath, `${JSON.stringify(payload, null, 2)}\n`);

    const slug = (record.phase || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const histName = `${new Date(payload.recordedAt).toISOString().replace(/[:.]/g, '-')}-${slug}.json`;
    fs.writeFileSync(path.join(root, histName), `${JSON.stringify(payload, null, 2)}\n`);
    return latestPath;
  } catch (e) {
    console.warn(`[buildFailure] record failed: ${(e as Error).message}`);
    return null;
  }
}

export function loadLatestBuildFailure(buildDir: string | null | undefined): BuildFailureRecord | null {
  if (!buildDir) return null;
  const latestPath = path.join(buildDir, BUILD_ERRORS_DIR, 'latest.json');
  if (!fs.existsSync(latestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(latestPath, 'utf8')) as BuildFailureRecord;
  } catch (_e) {
    return null;
  }
}

module.exports = {
  BUILD_ERRORS_DIR,
  recordBuildFailure,
  loadLatestBuildFailure,
};
