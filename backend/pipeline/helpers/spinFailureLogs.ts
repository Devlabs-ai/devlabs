'use strict';

/**
 * SPIN failure log handling — persist full logs to disk, extract compact signals
 * for the CODE repair agent (avoids stuffing 100KB+ logs into the LLM prompt).
 */

import * as fs from 'fs';
import * as path from 'path';

const SPIN_LOG_FILE = '.devlabs/spin-failure.log';
const MAX_EXTRACTED_LINES = 40;
const MAX_LINE_LEN = 500;

const ERROR_LINE_RE = /(?:^|\b)(?:ERROR|Error|FATAL|Fatal|Traceback|Exception|panic|failed|FAILED|exit(?:ed)?\s+(?:code\s+)?[1-9]\d*|cannot|Can't|unable to|denied|refused|timeout|OOM|Killed)/i;
const NOISE_RE = /^(DEBUG|TRACE|INFO\s+\[)/i;

function capLine(s: string): string {
  const t = s.trim();
  if (t.length <= MAX_LINE_LEN) return t;
  return `${t.slice(0, MAX_LINE_LEN)}…`;
}

/**
 * Scan container logs for high-signal error lines (deduped, ordered).
 */
export function extractFailureSignals(rawLogs: string | null | undefined): string[] {
  if (!rawLogs?.trim()) return [];
  const lines = rawLogs.split('\n');
  const seen = new Set<string>();
  const out: string[] = [];

  // Pass 1: explicit error patterns (most recent first)
  for (let i = lines.length - 1; i >= 0 && out.length < MAX_EXTRACTED_LINES; i--) {
    const line = lines[i].trim();
    if (!line || NOISE_RE.test(line)) continue;
    if (!ERROR_LINE_RE.test(line)) continue;
    const key = line.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.unshift(capLine(line));
  }

  // Pass 2: last non-empty lines from each container block if we found little
  if (out.length < 5) {
    for (let i = lines.length - 1; i >= 0 && out.length < MAX_EXTRACTED_LINES; i--) {
      const line = lines[i].trim();
      if (!line || line.length < 20) continue;
      if (NOISE_RE.test(line)) continue;
      const key = line.slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      out.unshift(capLine(line));
    }
  }

  return out.slice(-MAX_EXTRACTED_LINES);
}

export interface SpinFailureContext {
  message: string | null;
  composeStdout: string | null;
  composeStderr: string | null;
  /** Structured signals for the repair LLM — not raw logs */
  extractedErrors: string[];
  /** Relative path under buildDir, e.g. .devlabs/spin-failure.log */
  logFile: string | null;
  logBytes: number;
  logLineCount: number;
}

/**
 * Persist full SPIN logs to disk; return compact context for repair prompts.
 */
export function prepareSpinFailureContext(
  buildDir: string,
  err: {
    message?: string | null;
    composeStdout?: string | null;
    composeStderr?: string | null;
    logs?: string | null;
  },
): SpinFailureContext {
  const rawLogs = err.logs || '';
  const logBytes = Buffer.byteLength(rawLogs, 'utf8');
  const logLineCount = rawLogs ? rawLogs.split('\n').length : 0;
  let logFile: string | null = null;

  if (rawLogs.trim() && buildDir) {
    const absDir = path.join(buildDir, '.devlabs');
    fs.mkdirSync(absDir, { recursive: true });
    const absFile = path.join(absDir, 'spin-failure.log');
    fs.writeFileSync(absFile, rawLogs, 'utf8');
    logFile = SPIN_LOG_FILE;
  }

  const extractedErrors = extractFailureSignals(rawLogs);
  if (err.composeStderr) {
    const stderrLines = extractFailureSignals(err.composeStderr);
    for (const line of stderrLines) {
      if (!extractedErrors.includes(line)) extractedErrors.push(line);
    }
  }

  return {
    message: err.message || null,
    composeStdout: err.composeStdout || null,
    composeStderr: err.composeStderr || null,
    extractedErrors: extractedErrors.slice(0, MAX_EXTRACTED_LINES),
    logFile,
    logBytes,
    logLineCount,
  };
}

/** Shape passed into code agent repair payload (no raw 141KB logs). */
export function spinFailureForRepair(ctx: SpinFailureContext): Record<string, unknown> {
  return {
    message: ctx.message,
    composeStdout: ctx.composeStdout,
    composeStderr: ctx.composeStderr,
    extractedErrors: ctx.extractedErrors,
    logFile: ctx.logFile,
    logBytes: ctx.logBytes,
    logLineCount: ctx.logLineCount,
    hint: ctx.logFile
      ? `Full container logs are on disk at ${ctx.logFile}. Use read_file or grep on that path — do not expect logs inline.`
      : null,
  };
}

module.exports = {
  extractFailureSignals,
  prepareSpinFailureContext,
  spinFailureForRepair,
  SPIN_LOG_FILE,
};
