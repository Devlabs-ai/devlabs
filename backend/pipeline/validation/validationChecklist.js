'use strict';

function formatStepLabel(step) {
  if (!step) return 'Unknown step';
  if (step.type === 'http') {
    const path = step.path || '/';
    return `HTTP GET ${step.service}${path}`;
  }
  if (step.type === 'exec') {
    const cmd = Array.isArray(step.cmd) ? step.cmd.join(' ') : String(step.cmd || '');
    return `Exec ${step.service}: ${cmd}`;
  }
  return `${step.type || 'step'} ${step.service || ''}`.trim();
}

function buildValidationChecklist(draft, validationSpec) {
  const items = [];
  const symptoms = draft?.brokenState?.validationSymptoms || [];
  for (const s of symptoms) {
    const label = String(s.check || '').trim();
    if (!label) continue;
    items.push({
      id: `symptom-${s.id ?? items.length + 1}`,
      kind: 'symptom',
      order: s.id ?? items.length + 1,
      label,
      status: 'pending',
      detail: null,
    });
  }

  const steps = validationSpec?.steps || [];
  steps.forEach((step, i) => {
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

function applySymptomStatuses(items, passed) {
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

function applyValidationResults(checklist, { evidence = [], passed, feedback }) {
  const next = checklist.map((item) => ({ ...item }));
  let stepIdx = 0;
  for (const item of next) {
    if (item.kind === 'step') {
      const ev = evidence[stepIdx];
      stepIdx += 1;
      if (!ev) continue;
      item.status = ev.ok ? 'pass' : 'fail';
      if (ev.error) item.detail = ev.error;
      else if (ev.statusCode) item.detail = `HTTP ${ev.statusCode}`;
      else item.detail = ev.ok ? 'Step passed' : 'Check failed';
    }
    if (item.kind === 'judge') {
      item.status = passed ? 'pass' : 'fail';
      item.detail = feedback || null;
    }
  }
  applySymptomStatuses(next, passed);
  return next;
}

const PIPELINE_PHASES = [
  { id: 'generate', phase: 'GENERATE', label: 'Generate challenge assets' },
  { id: 'write', phase: 'WRITE', label: 'Write files to build directory' },
  { id: 'spin', phase: 'SPIN', label: 'Docker compose up & services running' },
  { id: 'validate', phase: 'VALIDATE', label: 'Validation checklist & judge' },
];

function buildPhaseChecklist(failedPhase) {
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
}) {
  const phases = buildPhaseChecklist(failedPhase);
  let items = [];
  if (validation?.checklist?.length) {
    items = validation.checklist;
  } else if (validationSpec && (failedPhase === 'VALIDATE' || !failedPhase)) {
    items = buildValidationChecklist(draft, validationSpec);
    if (validation?.evidence) {
      items = applyValidationResults(items, validation);
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
