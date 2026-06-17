'use strict';

/**
 * Build UI checklist — maps validationSpec.steps + judge result
 * into pass/fail items shown after each pipeline iteration.
 */

import type { ChallengeDraft, ChecklistItem, ValidationStep, ValidationResult } from '../../types/domain';
import type { ValidationGraphSpec, ValidationGraphNode, ValidationGraphNodeSnapshot, ValidationGraphEntry } from './validationGraphTypes';

interface ValidationSpecLocal {
  steps?: ValidationStep[];
  graph?: ValidationGraphSpec;
  graphs?: ValidationGraphEntry[];
  version?: number;
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

function formatGraphNodeLabel(nodeId: string, node: ValidationGraphNode): string {
  if (node.type === 'http') {
    return `${node.method || 'GET'} ${node.service}${node.path || '/'}`;
  }
  if (node.type === 'exec' || node.type === 'background') {
    const cmd = Array.isArray(node.cmd) ? node.cmd.join(' ') : String(node.cmd || '');
    return `${node.type} ${node.service}: ${cmd.slice(0, 100)}`;
  }
  return nodeId;
}

const GRAPH_CONTROL_TYPES = new Set(['fork', 'join', 'wait', 'stop']);

function buildValidationChecklistFromGraphs(
  graphs: ValidationGraphEntry[] | null | undefined,
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  if (!graphs?.length) return items;
  for (const entry of graphs) {
    for (const [nodeId, node] of Object.entries(entry.graph?.nodes || {})) {
      if (GRAPH_CONTROL_TYPES.has(node.type)) continue;
      items.push({
        id: `graph-${entry.symptomId}-${nodeId}`,
        kind: 'step',
        label: `Symptom ${entry.symptomId}: ${formatGraphNodeLabel(nodeId, node)}`,
        status: 'pending',
        detail: entry.symptomCheck.slice(0, 240) || null,
      });
    }
  }
  items.push({
    id: 'judge',
    kind: 'judge',
    label: 'Broken state is reproducible (validation judge)',
    status: 'pending',
    detail: null,
  });
  return items;
}

function buildValidationChecklistFromGraph(
  graph: ValidationGraphSpec | null | undefined,
): ChecklistItem[] {
  return buildValidationChecklistFromGraphs([{
    symptomId: 0,
    symptomCheck: '',
    graph: graph!,
  }]);
}

function buildValidationChecklist(
  validationSpec: ValidationSpecLocal | null | undefined,
): ChecklistItem[] {
  if (validationSpec?.graphs?.length) {
    return buildValidationChecklistFromGraphs(validationSpec.graphs);
  }
  if (validationSpec?.graph?.entry && validationSpec.graph.nodes) {
    return buildValidationChecklistFromGraph(validationSpec.graph);
  }
  const items: ChecklistItem[] = [];
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
      else item.detail = ev.ok ? 'Check passed' : 'Check failed';
    }
    if (item.kind === 'judge') {
      item.status = passed ? 'pass' : 'fail';
      item.detail = feedback || null;
    }
  }
  return next;
}

function applyGraphValidationResults(
  checklist: ChecklistItem[],
  {
    snapshots = [],
    passed,
    feedback,
  }: {
    snapshots?: ValidationGraphNodeSnapshot[];
    passed?: boolean;
    feedback?: string | null;
  },
): ChecklistItem[] {
  const next = checklist.map((item) => ({ ...item }));
  for (const item of next) {
    if (item.kind === 'step' && item.id.startsWith('graph-')) {
      const snap = snapshots.find((s) => item.id === `graph-${s.symptomId}-${s.nodeId}`);
      if (!snap) continue;
      item.status = snap.ok ? 'pass' : 'fail';
      item.detail = snap.error || (snap.statusCode ? `HTTP ${snap.statusCode}` : null)
        || (snap.ok ? 'Completed' : 'Failed');
    }
    if (item.kind === 'judge') {
      item.status = passed ? 'pass' : 'fail';
      item.detail = feedback || null;
    }
  }
  return next;
}

const PIPELINE_PHASES = [
  { id: 'code', phase: 'CODE', label: 'Code — scaffold & edit files' },
  { id: 'spin', phase: 'SPIN', label: 'Docker compose up & services running' },
  { id: 'validate', phase: 'VALIDATE', label: 'Validation checks & judge' },
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
    items = buildValidationChecklist(validationSpec);
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
  buildValidationChecklistFromGraphs,
  applyValidationResults,
  applyGraphValidationResults,
  buildPhaseChecklist,
  buildIterationChecklist,
  PIPELINE_PHASES,
};
