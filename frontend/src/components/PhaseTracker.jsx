import React from 'react';
import { buildCostLabel } from '../utils/buildCost.js';

export const PIPELINE_PHASES = ['GENERATE', 'WRITE', 'SPIN', 'VALIDATE'];

const PHASE_META = {
  GENERATE: { title: 'Generate', subtitle: 'Challenge assets' },
  WRITE: { title: 'Write', subtitle: 'Files to build dir' },
  SPIN: { title: 'Spin', subtitle: 'Compose & services' },
  START: { title: 'Spin', subtitle: 'Compose & services' },
  VALIDATE: { title: 'Validate', subtitle: 'Checklist & judge' },
};

const PHASE_ID_TO_KEY = {
  generate: 'GENERATE',
  write: 'WRITE',
  spin: 'SPIN',
  start: 'SPIN',
  validate: 'VALIDATE',
};

function normalizePipelinePhase(phase) {
  const upper = String(phase || '').toUpperCase();
  if (upper === 'START') return 'SPIN';
  return upper;
}

function resolvePhaseKey(idOrPhase) {
  const lower = String(idOrPhase || '').toLowerCase();
  if (PHASE_ID_TO_KEY[lower]) return PHASE_ID_TO_KEY[lower];
  return normalizePipelinePhase(idOrPhase);
}

function StepCheckIcon() {
  return (
    <svg className="pipeline-stepper__check" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M2.5 6.2 4.8 8.5 9.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StepFailIcon() {
  return (
    <svg className="pipeline-stepper__fail-icon" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** @typedef {'completed' | 'current' | 'upcoming' | 'failed' | 'skipped'} StepState */

/**
 * @param {{ id: string, title: string, subtitle: string, state: StepState, index: number }[]} steps
 */
function PipelineStepper({ steps, compact = false }) {
  if (!steps?.length) return null;

  return (
    <ol
      className={`pipeline-stepper ${compact ? 'pipeline-stepper--compact' : ''}`}
      aria-label="Pipeline progress"
    >
      {steps.map((step, index) => {
        const lineDone = step.state === 'completed';
        const showLine = index < steps.length - 1;

        return (
          <li
            key={step.id}
            className={`pipeline-stepper__step pipeline-stepper__step--${step.state}`}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <div className="pipeline-stepper__head">
              <span className="pipeline-stepper__indicator" title={step.subtitle}>
                {step.state === 'completed' && <StepCheckIcon />}
                {step.state === 'failed' && <StepFailIcon />}
                {(step.state === 'current' || step.state === 'upcoming' || step.state === 'skipped') && (
                  <span className="pipeline-stepper__index">{index + 1}</span>
                )}
              </span>
              {showLine && (
                <span
                  className={`pipeline-stepper__line ${lineDone ? 'done' : ''}`}
                  aria-hidden
                />
              )}
            </div>
            <div className="pipeline-stepper__labels">
              <span className="pipeline-stepper__title">{step.title}</span>
              {!compact && (
                <span className="pipeline-stepper__subtitle">{step.subtitle}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function liveStepState(idx, phaseIdx, finished, phase, validation, status) {
  const key = PIPELINE_PHASES[idx];
  const active = normalizePipelinePhase(phase);
  let done = phaseIdx > idx;
  let isCurrent = !finished && key === active;

  if (finished) {
    if (key === 'VALIDATE') {
      done = !!validation?.passed || status === 'review_ready';
    } else {
      done = idx <= phaseIdx;
    }
    isCurrent = false;
  }

  const failed = finished && key === 'VALIDATE' && validation && !validation.passed;

  if (failed) return 'failed';
  if (done) return 'completed';
  if (isCurrent) return 'current';
  return 'upcoming';
}

function buildLiveSteps(phase, validation, status, running) {
  const finished = !running
    && (status === 'review_ready' || status === 'failed' || !!validation);
  const phaseIdx = PIPELINE_PHASES.indexOf(normalizePipelinePhase(phase));

  return PIPELINE_PHASES.map((key, idx) => {
    const meta = PHASE_META[key] || { title: key, subtitle: key };
    return {
      id: key,
      title: meta.title,
      subtitle: meta.subtitle,
      state: liveStepState(idx, phaseIdx, finished, phase, validation, status),
      index: idx,
    };
  });
}

function checklistStepState(status) {
  if (status === 'pass') return 'completed';
  if (status === 'fail') return 'failed';
  if (status === 'skip') return 'skipped';
  return 'upcoming';
}

function trackerShell({ className, onSelect, onClickArg, title, children }) {
  if (onSelect) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => onSelect(onClickArg)}
        title={title}
      >
        {children}
      </button>
    );
  }
  return <div className={className}>{children}</div>;
}

/** Live build tracker (Build tab and pipeline history “current run”). */
export function PhaseTracker({
  phase,
  attempt,
  total,
  status,
  validation,
  running,
  attemptLabelOnly = false,
  onSelect,
}) {
  const attemptLabel = attemptLabelOnly
    ? `Attempt ${attempt || 0}`
    : `Attempt ${attempt || 0} / ${total || 5}`;

  const className = [
    'phase-tracker',
    onSelect ? 'phase-tracker--clickable' : '',
    attemptLabelOnly ? 'phase-tracker--compact' : '',
  ].filter(Boolean).join(' ');

  const steps = buildLiveSteps(phase, validation, status, running);

  return trackerShell({
    className,
    onSelect,
    onClickArg: attempt,
    title: onSelect ? `View build logs for attempt ${attempt || 0}` : undefined,
    children: (
      <>
        <PipelineStepper steps={steps} compact={attemptLabelOnly} />
        <div className={`phase-meta ${attemptLabelOnly ? 'phase-meta--attempt-only' : ''}`}>
          <span>{attemptLabel}</span>
          {!attemptLabelOnly && (
            <span className={`status-pill ${status || 'idle'}`}>{status || 'idle'}</span>
          )}
        </div>
      </>
    ),
  });
}

/** One completed / recorded iteration from buildChecklists. */
export function ChecklistPhaseTracker({ checklist, onSelect, selected }) {
  if (!checklist) return null;
  const phases = checklist.phases || [];

  const steps = phases.map((p, index) => {
    const key = resolvePhaseKey(p.id);
    const meta = PHASE_META[key] || { title: key, subtitle: p.label || key };
    return {
      id: p.id || key,
      title: meta.title,
      subtitle: p.label || meta.subtitle,
      state: checklist.passed && p.status !== 'fail'
        ? 'completed'
        : checklistStepState(p.status),
      index,
    };
  });

  const className = [
    'phase-tracker',
    'phase-tracker--compact',
    onSelect ? 'phase-tracker--clickable' : '',
    selected ? 'phase-tracker--selected' : '',
  ].filter(Boolean).join(' ');

  return trackerShell({
    className,
    onSelect,
    onClickArg: checklist.attempt,
    title: onSelect ? `View build logs for attempt ${checklist.attempt}` : undefined,
    children: (
      <>
        <PipelineStepper steps={steps} compact />
        <div className="phase-meta phase-meta--attempt-only">
          <span>Attempt {checklist.attempt}</span>
          {buildCostLabel(checklist.cost) && (
            <span className="pipeline-build-cost" title="Estimated LLM cost for this iteration">
              {buildCostLabel(checklist.cost)}
            </span>
          )}
        </div>
      </>
    ),
  });
}
