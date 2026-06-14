'use strict';

import type { ChallengeDraft, ChecklistItem, ValidationStep, ValidationResult } from '../../types/domain';

interface ValidationSpecLocal {
  steps?: ValidationStep[];
  [key: string]: unknown;
}

interface IterationCostSummary {
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
}

function formatStepLabel(step: ValidationStep | null | undefined): string {
  if (!step) return 'Unknown step';
  if (step.type === 'http') {
    const p = step.path || '/';
    return `HTTP GET ${step.service}${p}`;
  }
  if (step.type === 'exec') {
    const cmd = Array.isArray(step.cmd) ? step.cmd.join(' ') : String(step.cmd || '');
    return `Exec ${step.service}: ${cmd}`;
  }
  return `${step.type || 'step'} ${step.service || ''}`.trim();
}

function buildValidationChecklist(
  draft: ChallengeDraft | null | undefined,
  validationSpec: ValidationSpecLocal | null | undefined,
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const symptoms = draft?.brokenState?.validationSymptoms || [];
  for (const s of symptoms) {
    const sym = s as Record<string, unknown>;
    const label = String(sym.check || '').trim();
    if (!label) continue;
    items.push({
      id: `symptom-${(sym.id as number) ?? items.length + 1}`,
      kind: 'symptom',
      order: (sym.id as number) ?? items.length + 1,
      label,
      status: 'pending',
      detail: null,
    });
  }

  const steps = validationSpec?.steps || [];
  steps.forEach((step: ValidationStep, i: number) => {
    items.push({
      id: `step-${i}`,
      kind: 'step',
      label: formatStepLabel(step),
      status: 'pending',
      detail: null,
    });
  });

  items.push({
    id: 'judge',
    kind: 'judge',
    label: 'Broken state is reproducible (validation judge)',
    status: 'pending',
    detail: null,
  });

  return items;
}

function applySymptomStatuses(items: ChecklistItem[], passed: boolean): void {
  for (const item of items) {
    if (item.kind !== 'symptom') continue;
    const lower = item.label.toLowerCase();
    if (lower.startsWith('fixed:')) {
      item.status = 'skip';
      item.detail = 'Verified after candidate fix (not checked at build time)';
    } else if (lower.startsWith('broken:')) {
      item.status = passed ? 'pass' : 'fail';
      item.detail = passed ? 'Observed in sandbox' : 'Not confirmed';
    } else {
      item.status = passed ? 'pass' : 'fail';
    }
  }
}

function applyValidationResults(
  checklist: ChecklistItem[],
  {
    evidence = [],
    passed,
    feedback,
  }: {
    evidence?: Array<Record<string, unknown>>;
    passed?: boolean;
    feedback?: string | null;
  },
): ChecklistItem[] {
  const next = checklist.map((item) => ({ ...item }));
  let stepIdx = 0;
  for (const item of next) {
    if (item.kind === 'step') {
      const ev = evidence[stepIdx];
      stepIdx += 1;
      if (!ev) continue;
      item.status = ev.ok ? 'pass' : 'fail';
      if (ev.error) item.detail = String(ev.error);
      else if (ev.statusCode) item.detail = `HTTP ${ev.statusCode as number}`;
      else item.detail = ev.ok ? 'Step passed' : 'Check failed';
    }
    if (item.kind === 'judge') {
      item.status = passed ? 'pass' : 'fail';
      item.detail = feedback || null;
    }
  }
  applySymptomStatuses(next, !!passed);
  return next;
}

const PIPELINE_PHASES = [
  { id: 'code', phase: 'CODE', label: 'Code — scaffold & edit files' },
  { id: 'spin', phase: 'SPIN', label: 'Docker compose up & services running' },
  { id: 'validate', phase: 'VALIDATE', label: 'Validation checklist & judge' },
];

function buildPhaseChecklist(failedPhase: string | null | undefined): Array<{ id: string; label: string; status: string }> {
  const failIdx = failedPhase
    ? PIPELINE_PHASES.findIndex((p) => p.phase === failedPhase)
    : -1;
  return PIPELINE_PHASES.map((p, i) => {
    let status = 'pass';
    if (failIdx >= 0) {
      if (i < failIdx) status = 'pass';
      else if (i === failIdx) status = 'fail';
      else status = 'skip';
    }
    return { id: p.id, label: p.label, status };
  });
}

function buildIterationChecklist({
  attempt,
  total,
  failedPhase,
  validation,
  draft,
  validationSpec,
  cost = null,
}: {
  attempt: number;
  total: number;
  failedPhase?: string | null;
  validation?: Partial<ValidationResult> | null;
  draft?: ChallengeDraft | null;
  validationSpec?: ValidationSpecLocal | null;
  cost?: IterationCostSummary | null;
}): {
  attempt: number;
  total: number;
  failedPhase: string | null;
  passed: boolean;
  phases: Array<{ id: string; label: string; status: string }>;
  items: ChecklistItem[];
  feedback: string | null;
  suggestions: string[];
  cost: IterationCostSummary | null;
} {
  const phases = buildPhaseChecklist(failedPhase);
  let items: ChecklistItem[] = [];
  if (validation?.checklist?.length) {
    items = validation.checklist as ChecklistItem[];
  } else if (validationSpec && (failedPhase === 'VALIDATE' || !failedPhase)) {
    items = buildValidationChecklist(draft, validationSpec);
    if (validation?.evidence) {
      items = applyValidationResults(items, validation as { evidence: Array<Record<string, unknown>>; passed?: boolean; feedback?: string });
    }
  }
  const passed = !failedPhase && !!validation?.passed;
  return {
    attempt,
    total,
    failedPhase: failedPhase || null,
    passed,
    phases,
    items,
    feedback: validation?.feedback || null,
    suggestions: validation?.suggestions || [],
    cost: cost && (cost.totalUsd > 0 || cost.inputTokens > 0) ? cost : null,
  };
}

module.exports = {
  formatStepLabel,
  buildValidationChecklist,
  applyValidationResults,
  buildPhaseChecklist,
  buildIterationChecklist,
  PIPELINE_PHASES,
};
