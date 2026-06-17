'use strict';

/**
 * Normalize validationSpec.steps to the shape validationAgent.runStep expects.
 * Converts legacy { request, expect } HTTP steps to { service, path, check }.
 */

import type { ValidationStep } from '../../types/domain';

/**
 * Normalize validationSpec.steps to the shape validationAgent.runStep expects.
 * Supports legacy { request, expect } HTTP steps and passes through http/exec.
 */
export function normalizeValidationStep(step: Record<string, unknown>): ValidationStep {
  if (!step || typeof step !== 'object') return step as unknown as ValidationStep;

  if (step.type === 'http' && step.request && typeof step.request === 'object' && !step.service) {
    const req = step.request as { method?: string; url?: string };
    const expect = step.expect as { status?: number; bodyContains?: string } | undefined;
    let service = step.service as string | undefined;
    let pathPart = step.path as string | undefined;
    let port = step.port as number | undefined;
    const url = String(req.url || '');

    if (url) {
      const m = url.match(/^https?:\/\/([^/:]+)(?::(\d+))?(\/[^?#]*)?/);
      if (m) {
        service = service || m[1];
        port = port ?? (m[2] ? parseInt(m[2], 10) : undefined);
        pathPart = pathPart || m[3] || '/';
      }
    }

    let check = step.check as ValidationStep['check'];
    if (!check && expect) {
      if (expect.bodyContains) check = { contains: expect.bodyContains };
      else if (expect.status != null && expect.status >= 200 && expect.status < 400) {
        check = { statusOk: true };
      }
    }

    return {
      type: 'http',
      service,
      path: pathPart,
      port,
      method: req.method || (step.method as string) || 'GET',
      check,
    };
  }

  return step as unknown as ValidationStep;
}

export function normalizeValidationSteps(steps: unknown[]): ValidationStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => normalizeValidationStep(s as Record<string, unknown>));
}

module.exports = {
  normalizeValidationStep,
  normalizeValidationSteps,
};
