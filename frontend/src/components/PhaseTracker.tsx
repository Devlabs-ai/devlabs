import React from 'react';
import { buildCostLabel } from '../utils/buildCost';

export const PIPELINE_PHASES = ['CODE', 'SPIN', 'VALIDATE'];

const PHASE_META: Record<string, { title: string; subtitle: string }> = {
  CODE: { title: 'Code', subtitle: 'Scaffold & edit files' },
  GENERATE: { title: 'Code', subtitle: 'Scaffold & edit files' },
  WRITE: { title: 'Code', subtitle: 'Scaffold & edit files' },
  SPIN: { title: 'Spin', subtitle: 'Compose & services' },
  VALIDATE: { title: 'Validate', subtitle: 'Checklist & judge' },
};

const PHASE_ID_TO_KEY: Record<string, string> = {
  code: 'CODE',
  generate: 'CODE',
  write: 'CODE',
  spin: 'SPIN',
  validate: 'VALIDATE',
};

function normalizePipelinePhase(phase: string | null | undefined): string {
  const upper = String(phase || '').toUpperCase();
  if (upper === 'GENERATE' || upper === 'WRITE') return 'CODE';
  return upper;
}

function resolvePhaseKey(idOrPhase: string | null | undefined): string {
  const lower = String(idOrPhase || '').toLowerCase();
  if (PHASE_ID_TO_KEY[lower]) return PHASE_ID_TO_KEY[lower];
  return normalizePipelinePhase(idOrPhase);
}

function StepCheckIcon(): JSX.Element {
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

function StepFailIcon(): JSX.Element {
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

type StepState = 'completed' | 'current' | 'upcoming' | 'failed' | 'skipped';

interface PipelineStep {
  id: string;
  title: string;
  subtitle: string;
  state: StepState;
  index: number;
}

interface PipelineStepperProps {
  steps: PipelineStep[];
  compact?: boolean;
}

function PipelineStepper({ steps, compact = false }: PipelineStepperProps): JSX.Element | null {
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

function liveStepState(
  idx: number,
  phaseIdx: number,
  finished: boolean,
  phase: string | null | undefined,
  validation: { passed?: boolean } | null | undefined,
  status: string | null | undefined,
): StepState {
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

function buildLiveSteps(
  phase: string | null | undefined,
  validation: { passed?: boolean } | null | undefined,
  status: string | null | undefined,
  running: boolean,
): PipelineStep[] {
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

function checklistStepState(status: string | undefined): StepState {
  if (status === 'pass') return 'completed';
  if (status === 'fail') return 'failed';
  if (status === 'skip') return 'skipped';
  return 'upcoming';
}

interface TrackerShellProps {
  className: string;
  onSelect?: (() => void) | ((attempt: number) => void);
  onClickArg?: number;
  title?: string;
  children: React.ReactNode;
}

function trackerShell({ className, onSelect, onClickArg, title, children }: TrackerShellProps): JSX.Element {
  if (onSelect) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => (onSelect as (arg: number | undefined) => void)(onClickArg)}
        title={title}
      >
        {children}
      </button>
    );
  }
  return <div className={className}>{children}</div>;
}

export interface PhaseTrackerProps {
  phase: string | null | undefined;
  attempt: number;
  total: number;
  status: string | null | undefined;
  validation: { passed?: boolean } | null | undefined;
  running: boolean;
  attemptLabelOnly?: boolean;
  onSelect?: (attempt?: number) => void;
}

/** Live build tracker (Build tab and pipeline history "current run"). */
export function PhaseTracker({
  phase,
  attempt,
  total,
  status,
  validation,
  running,
  attemptLabelOnly = false,
  onSelect,
}: PhaseTrackerProps): JSX.Element {
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

interface ChecklistEntry {
  attempt?: number;
  total?: number;
  passed?: boolean;
  failedPhase?: string;
  phases?: Array<{ id?: string; label?: string; status?: string }>;
  cost?: unknown;
}

export type { ChecklistEntry };

export interface ChecklistPhaseTrackerProps {
  checklist: ChecklistEntry | null | undefined;
  onSelect?: (attempt?: number) => void;
  selected?: boolean;
}

/** One completed / recorded iteration from buildChecklists. */
export function ChecklistPhaseTracker({
  checklist,
  onSelect,
  selected,
}: ChecklistPhaseTrackerProps): JSX.Element | null {
  if (!checklist) return null;
  const phases = checklist.phases || [];

  const steps: PipelineStep[] = phases.map((p, index) => {
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
