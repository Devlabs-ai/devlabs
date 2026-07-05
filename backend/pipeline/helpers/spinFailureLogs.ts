'use strict';

/**
 * SPIN failure evidence — persist full logs on disk, pass compact repair payload to CODE agent.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { PortMap } from '../../types/domain';

const composeManager = require('../../sandbox/composeManager');

export type SpinFailureKind = 'COMPOSE_UP' | 'SERVICE_RUNTIME';

export const SPIN_LOG_FILE = '.devlabs/spin-failure.log';
export const SPIN_PS_FILE = '.devlabs/spin-ps.json';
export const SPIN_STDOUT_FILE = '.devlabs/spin-compose-up.stdout';
export const SPIN_STDERR_FILE = '.devlabs/spin-compose-up.stderr';

const MAX_EXTRACTED_LINES = 40;
const MAX_LINE_LEN = 500;
const MESSAGE_MAX = 500;
const PS_LINE_MAX = 120;
const PS_BLOCK_MAX = 1500;
const PS_SERVICE_MAX = 20;

const ERROR_LINE_RE = /(?:^|\b)(?:ERROR|Error|FATAL|Fatal|Traceback|Exception|panic|failed|FAILED|exit(?:ed)?\s+(?:code\s+)?[1-9]\d*|cannot|Can't|unable to|denied|refused|timeout|OOM|Killed|failed to solve|Dockerfile:|Bind for)/i;
const NOISE_RE = /^(DEBUG|TRACE|INFO\s+\[)/i;
const PATH_IN_LINE_RE = /(?:services\/|[\w.-]+\.(?:py|js|ts|yml|yaml|json|sh|sql|txt))|Dockerfile|docker-compose\.yml|challenge\.json/i;

export interface SpinFailureInput {
  failureKind: SpinFailureKind;
  message: string;
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  containerLogs?: string | null;
  psServices?: Record<string, unknown>[] | null;
}

export interface SpinFailureContext {
  failureKind: SpinFailureKind;
  message: string | null;
  exitCode?: number | null;
  psSnapshot?: string | null;
  psFile?: string | null;
  extractedErrors: string[];
  logFile: string | null;
  logBytes: number;
  logLineCount: number;
}

function capLine(s: string): string {
  const t = s.trim();
  if (t.length <= MAX_LINE_LEN) return t;
  return `${t.slice(0, MAX_LINE_LEN)}…`;
}

function capText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

function joinSections(...parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p == null ? '' : String(p)).trim())
    .filter(Boolean)
    .join('\n');
}

function lastErrorLine(text: string): string | null {
  if (!text?.trim()) return null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (NOISE_RE.test(lines[i])) continue;
    if (ERROR_LINE_RE.test(lines[i])) return capLine(lines[i]);
  }
  return lines.length ? capLine(lines[lines.length - 1]) : null;
}

function dockerfileBlockLine(text: string): string | null {
  if (!text?.trim()) return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (/failed to solve|Dockerfile:\d+/i.test(t)) return capLine(t);
  }
  return null;
}

/** Build a one-line COMPOSE_UP summary from exit code + compose CLI streams. */
export function buildComposeUpMessage(
  exitCode: number | null | undefined,
  stdout: string | null | undefined,
  stderr: string | null | undefined,
): string {
  const errOut = stderr ? composeManager.stripDockerNoise(String(stderr)) : '';
  const stdOut = stdout ? composeManager.stripDockerNoise(String(stdout)) : '';
  const line = lastErrorLine(errOut)
    || lastErrorLine(stdOut)
    || dockerfileBlockLine(errOut)
    || dockerfileBlockLine(stdOut);
  const code = exitCode != null ? exitCode : '?';
  if (line) return capText(`compose up failed (exit ${code}): ${line}`, MESSAGE_MAX);
  return `compose up failed (exit ${code})`;
}

function psExitCode(svc: Record<string, unknown>): number {
  const m = (String(svc.Status || '')).match(/Exited \((\d+)\)/i);
  return m ? parseInt(m[1], 10) : (svc.ExitCode != null ? (svc.ExitCode as number) : -1);
}

function isNonOkService(svc: Record<string, unknown>): boolean {
  const state = String(svc.State || '').toLowerCase();
  if (state === 'dead') return true;
  if (state === 'restarting') return true;
  if (state === 'exited' && psExitCode(svc) !== 0) return true;
  return false;
}

/** Service names that likely produced the failure (for targeted log capture). */
export function listFailingServiceNames(services: Record<string, unknown>[]): string[] {
  const names: string[] = [];
  for (const svc of services) {
    if (!isNonOkService(svc)) continue;
    const name = String(svc.Service || svc.Name || '').trim();
    if (name) names.push(name);
  }
  return names;
}

function formatPsLine(svc: Record<string, unknown>): string {
  const name = String(svc.Service || svc.Name || 'unknown');
  const state = String(svc.State || 'unknown').toLowerCase();
  const status = String(svc.Status || '').trim();
  let line = `${name}: ${state}`;
  if (status) line += ` — ${status}`;
  if (line.length > PS_LINE_MAX) line = `${line.slice(0, PS_LINE_MAX)}…`;
  return line;
}

/** Abbreviated ps block for the repair prompt (full JSON on disk). */
export function abbreviatePsSnapshot(services: Record<string, unknown>[]): string {
  if (!services.length) return '';
  const failing = services.filter(isNonOkService);
  const ok = services.filter((s) => !isNonOkService(s));
  const ordered = [...failing, ...ok];
  const lines = ordered.slice(0, PS_SERVICE_MAX).map(formatPsLine);
  if (ordered.length > PS_SERVICE_MAX) {
    lines.push(`… +${ordered.length - PS_SERVICE_MAX} more`);
  }
  return capText(lines.join('\n'), PS_BLOCK_MAX);
}

/** Scan logs for high-signal error lines (deduped, ordered). */
export function extractFailureSignals(rawLogs: string | null | undefined): string[] {
  if (!rawLogs?.trim()) return [];
  const lines = rawLogs.split('\n');
  const seen = new Set<string>();
  const out: string[] = [];

  for (let i = lines.length - 1; i >= 0 && out.length < MAX_EXTRACTED_LINES; i--) {
    const line = lines[i].trim();
    if (!line || NOISE_RE.test(line)) continue;
    if (!ERROR_LINE_RE.test(line)) continue;
    const key = line.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.unshift(capLine(line));
  }

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

  return prioritizePathLines(out);
}

function prioritizePathLines(lines: string[]): string[] {
  if (lines.length <= MAX_EXTRACTED_LINES) return lines;
  const withPath = lines.filter((l) => PATH_IN_LINE_RE.test(l));
  const withoutPath = lines.filter((l) => !PATH_IN_LINE_RE.test(l));
  const out = [...withPath];
  for (const line of withoutPath) {
    if (out.length >= MAX_EXTRACTED_LINES) break;
    if (!out.includes(line)) out.push(line);
  }
  return out.slice(0, MAX_EXTRACTED_LINES);
}

function writeDevlabsFile(buildDir: string, rel: string, content: string): void {
  const absDir = path.join(buildDir, '.devlabs');
  fs.mkdirSync(absDir, { recursive: true });
  fs.writeFileSync(path.join(absDir, path.basename(rel)), content, 'utf8');
}

function buildNote(ctx: SpinFailureContext): string | null {
  const parts: string[] = [];
  if (ctx.logFile) {
    parts.push(`Full logs are on disk at ${ctx.logFile}. Use read_file or grep when extractedErrors is insufficient.`);
  }
  if (ctx.failureKind === 'SERVICE_RUNTIME' && ctx.psFile) {
    parts.push(`Full compose ps snapshot is at ${ctx.psFile}.`);
  }
  return parts.length ? parts.join(' ') : null;
}

/** Fetch container logs — failing services first, then all. */
export async function captureContainerLogs(
  buildDir: string,
  portMap: PortMap | null | undefined,
  failingServiceNames: string[] = [],
): Promise<string> {
  const tail = 150;
  const chunks: string[] = [];

  if (failingServiceNames.length) {
    for (const svc of failingServiceNames) {
      try {
        const { stdout, stderr } = await composeManager.logs(buildDir, svc, {
          tail,
          portMap: portMap || undefined,
        });
        const chunk = joinSections(stdout as string, stderr as string);
        if (chunk) chunks.push(chunk);
      } catch (_e) {
        /* skip single service */
      }
    }
  }

  if (chunks.length) return chunks.join('\n\n');

  try {
    const { stdout, stderr } = await composeManager.logs(buildDir, '', {
      tail: 200,
      portMap: portMap || undefined,
    });
    return joinSections(stdout as string, stderr as string);
  } catch (e) {
    const err = e as Record<string, unknown>;
    return joinSections(
      err.stdout as string | null | undefined,
      err.stderr as string | null | undefined,
      (e as Error).message,
    );
  }
}

/** Persist evidence files and return compact repair context. */
export function prepareSpinFailureContext(
  buildDir: string,
  input: SpinFailureInput,
): SpinFailureContext {
  let logBody = '';
  let psFile: string | null = null;
  let psSnapshot: string | null = null;
  const extractSources: string[] = [];

  if (input.failureKind === 'COMPOSE_UP') {
    const stdout = input.stdout || '';
    const stderr = input.stderr || '';
    if (stdout.trim() && buildDir) writeDevlabsFile(buildDir, SPIN_STDOUT_FILE, stdout);
    if (stderr.trim() && buildDir) writeDevlabsFile(buildDir, SPIN_STDERR_FILE, stderr);
    logBody = joinSections(stderr, stdout, input.containerLogs || null);
    if (stderr) extractSources.push(stderr);
    if (stdout) extractSources.push(stdout);
    if (input.containerLogs) extractSources.push(input.containerLogs);
  } else {
    const services = input.psServices || [];
    if (services.length && buildDir) {
      writeDevlabsFile(buildDir, SPIN_PS_FILE, `${JSON.stringify(services, null, 2)}\n`);
      psFile = SPIN_PS_FILE;
      psSnapshot = abbreviatePsSnapshot(services) || null;
    }
    logBody = input.containerLogs || '';
    if (logBody) extractSources.push(logBody);
    if (psSnapshot) extractSources.push(psSnapshot);
  }

  let logFile: string | null = null;
  if (logBody.trim() && buildDir) {
    writeDevlabsFile(buildDir, SPIN_LOG_FILE, logBody);
    logFile = SPIN_LOG_FILE;
  }

  const logBytes = Buffer.byteLength(logBody, 'utf8');
  const logLineCount = logBody ? logBody.split('\n').length : 0;
  const extractedErrors = prioritizePathLines(
    extractFailureSignals(extractSources.join('\n')),
  );

  const ctx: SpinFailureContext = {
    failureKind: input.failureKind,
    message: input.message || null,
    extractedErrors,
    logFile,
    logBytes,
    logLineCount,
  };

  if (input.failureKind === 'COMPOSE_UP') {
    ctx.exitCode = input.exitCode ?? null;
  } else {
    ctx.psSnapshot = psSnapshot;
    ctx.psFile = psFile;
  }

  return ctx;
}

/** Shape passed into CODE agent repair payload — no inline raw logs. */
export function spinFailureForRepair(ctx: SpinFailureContext): Record<string, unknown> {
  const out: Record<string, unknown> = {
    failureKind: ctx.failureKind,
    message: ctx.message,
    extractedErrors: ctx.extractedErrors,
    logFile: ctx.logFile,
    logBytes: ctx.logBytes,
    logLineCount: ctx.logLineCount,
    note: buildNote(ctx),
  };

  if (ctx.failureKind === 'COMPOSE_UP') {
    out.exitCode = ctx.exitCode ?? null;
  } else {
    if (ctx.psSnapshot) out.psSnapshot = ctx.psSnapshot;
    if (ctx.psFile) out.psFile = ctx.psFile;
  }

  return out;
}

module.exports = {
  buildComposeUpMessage,
  extractFailureSignals,
  listFailingServiceNames,
  abbreviatePsSnapshot,
  captureContainerLogs,
  prepareSpinFailureContext,
  spinFailureForRepair,
  SPIN_LOG_FILE,
  SPIN_PS_FILE,
  SPIN_STDOUT_FILE,
  SPIN_STDERR_FILE,
};
