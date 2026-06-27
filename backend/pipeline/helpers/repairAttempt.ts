'use strict';

/**
 * Shape BuildAttempt records for CODE repair payloads and lesson lookup.
 */

import type { BuildAttempt } from '../../types/domain';

const { spinFailureForRepair } = require('./spinFailureLogs');

function cap(s: unknown, max: number): string | null {
  if (s == null) return null;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated ${str.length - max} chars]`;
}

function slimValidateEvidence(evidence: unknown): unknown[] {
  if (!Array.isArray(evidence)) return [];
  return evidence.slice(0, 20).map((ev) => {
    if (!ev || typeof ev !== 'object') return ev;
    const e = ev as Record<string, unknown>;
    return {
      step: e.step,
      ok: e.ok,
      label: e.label,
      statusCode: e.statusCode,
      body: cap(e.body, 500),
      stdout: cap(e.stdout, 1500),
      stderr: cap(e.stderr, 800),
      error: e.error,
    };
  });
}

function slimSpinDetails(attempt: BuildAttempt, d: Record<string, unknown>): Record<string, unknown> {
  const shaped = spinFailureForRepair({
    message: attempt.message,
    extractedErrors: Array.isArray(d.extractedErrors) ? d.extractedErrors as string[] : [],
    logFile: typeof d.logFile === 'string' ? d.logFile : null,
    logBytes: typeof d.logBytes === 'number' ? d.logBytes : undefined,
    logLineCount: typeof d.logLineCount === 'number' ? d.logLineCount : undefined,
    composeStdout: null,
    composeStderr: null,
    logs: null,
  });
  return shaped as Record<string, unknown>;
}

function slimValidateDetails(attempt: BuildAttempt, d: Record<string, unknown>): Record<string, unknown> {
  return {
    message: attempt.message,
    feedback: cap(d.feedback, 400) || attempt.message,
    suggestions: Array.isArray(d.suggestions) ? (d.suggestions as string[]).slice(0, 8) : [],
    evidence: slimValidateEvidence(d.evidence),
  };
}

function slimCodeDetails(attempt: BuildAttempt, d: Record<string, unknown>): Record<string, unknown> {
  return {
    message: cap(d.message, 600) || attempt.message,
  };
}

/** Cap and phase-shape details before sending previousAttempt to the CODE agent. */
export function sanitizePreviousAttemptForRepair(
  prev: BuildAttempt | null | undefined,
): BuildAttempt | null {
  if (!prev?.phase) return null;

  const phase = String(prev.phase).toUpperCase();
  const out: BuildAttempt = {
    phase: prev.phase,
    message: prev.message,
    artifacts: null,
    rawText: cap(prev.rawText, 2000) || null,
    details: null,
  };

  const d = (prev.details && typeof prev.details === 'object'
    ? prev.details
    : {}) as Record<string, unknown>;

  if (phase === 'SPIN') {
    out.details = slimSpinDetails(prev, d);
  } else if (phase === 'VALIDATE') {
    out.details = slimValidateDetails(prev, d);
  } else {
    out.details = slimCodeDetails(prev, d);
  }

  return out;
}

/** True when the last failure should drive repair-mode lessons / mandatory edits. */
export function isActionableRepairFailure(attempt: BuildAttempt | null | undefined): boolean {
  if (!attempt?.phase) return false;
  const phase = String(attempt.phase).toUpperCase();
  return phase === 'SPIN' || phase === 'VALIDATE' || phase === 'CODE';
}

/** Flatten previousAttempt into text for lesson similarity search. */
export function failureTextForLessons(attempt: BuildAttempt | null | undefined): string {
  if (!attempt?.phase) return '';
  const parts: string[] = [attempt.message || ''];
  const d = attempt.details as Record<string, unknown> | null | undefined;
  const phase = String(attempt.phase).toUpperCase();

  if (phase === 'SPIN') {
    if (d?.composeStderr) parts.push(String(d.composeStderr));
    if (Array.isArray(d?.extractedErrors) && (d.extractedErrors as string[]).length) {
      parts.push((d.extractedErrors as string[]).join('\n'));
    } else if (d?.logs) {
      parts.push(String(d.logs));
    }
  } else if (phase === 'VALIDATE') {
    if (Array.isArray(d?.suggestions)) {
      parts.push((d.suggestions as string[]).join(' '));
    }
    if (d?.feedback) parts.push(String(d.feedback));
  }

  return parts.filter(Boolean).join('\n').trim();
}

module.exports = {
  sanitizePreviousAttemptForRepair,
  isActionableRepairFailure,
  failureTextForLessons,
};
