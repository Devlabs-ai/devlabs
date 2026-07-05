'use strict';

/**
 * Append-only build lifecycle log — every pipeline event across all iterations.
 * Written to sandbox/builds/<id>/.devlabs/build-lifecycle.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';

export const BUILD_LIFECYCLE_FILE = '.devlabs/build-lifecycle.jsonl';

/** Safety cap per JSONL line (full codeDiff / validation payloads can be large). */
const MAX_RECORD_BYTES = 4 * 1024 * 1024;

export interface BuildLifecycleSession {
  draftSessionId: string;
  buildSessionId: string;
  resumed: boolean;
}

export interface BuildLifecycleLogger {
  filePath: string;
  append(event: unknown): void;
  finish(meta: Record<string, unknown>): void;
}

function lifecycleAbsPath(buildDir: string): string {
  const devlabs = path.join(buildDir, '.devlabs');
  fs.mkdirSync(devlabs, { recursive: true });
  return path.join(devlabs, path.basename(BUILD_LIFECYCLE_FILE));
}

function serializeRecord(event: unknown): string {
  const record = {
    ts: new Date().toISOString(),
    event,
  };
  let line = JSON.stringify(record);
  if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
    const ev = event && typeof event === 'object'
      ? event as Record<string, unknown>
      : {};
    line = JSON.stringify({
      ts: record.ts,
      event: {
        type: ev.type ?? 'unknown',
        _truncated: true,
        _originalBytes: Buffer.byteLength(JSON.stringify(record), 'utf8'),
        _note: 'Event exceeded max record size; inspect agent artifacts on disk',
      },
    });
  }
  return `${line}\n`;
}

function appendLine(filePath: string, event: unknown): void {
  fs.appendFileSync(filePath, serializeRecord(event), 'utf8');
}

/** Create (or append to) the lifecycle log for one build workspace. */
export function createBuildLifecycleLogger(
  buildDir: string,
  session: BuildLifecycleSession,
): BuildLifecycleLogger {
  const filePath = lifecycleAbsPath(buildDir);

  appendLine(filePath, {
    type: 'session_start',
    draftSessionId: session.draftSessionId,
    buildSessionId: session.buildSessionId,
    resumed: session.resumed,
    buildDir,
    lifecycleFile: BUILD_LIFECYCLE_FILE,
  });

  return {
    filePath,
    append(event: unknown) {
      try {
        appendLine(filePath, event);
      } catch (e) {
        console.warn(`[buildLifecycle] append failed: ${(e as Error).message}`);
      }
    },
    finish(meta: Record<string, unknown>) {
      try {
        appendLine(filePath, { type: 'session_end', ...meta });
      } catch (e) {
        console.warn(`[buildLifecycle] finish failed: ${(e as Error).message}`);
      }
    },
  };
}

module.exports = {
  BUILD_LIFECYCLE_FILE,
  createBuildLifecycleLogger,
};
