import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PhaseTracker } from '../components/PhaseTracker';
import AuthorReviewFeedbackBanner from '../components/AuthorReviewFeedbackBanner';
import { streamBuild, getProblemSession } from '../services/problemApi';
import { logsForAttempt } from '../utils/buildLogFilter';
import { buildCostLabel } from '../utils/buildCost';
import { formatCodeDiffLines } from '../utils/pipelineLogFormat';
import PipelineLogStream from '../components/PipelineLogStream';
import type { ProblemSession } from '../types/domain';

interface LlmConfig {
  llmConfigured: boolean;
  maxIterations?: number;
  provider?: string;
}

interface PipelinePageProps {
  draft: ProblemSession | null;
  llmConfig: LlmConfig | null;
  onDraftChanged: (draft: ProblemSession) => void;
  onGoReview?: () => void;
  onCancelBuild?: () => void;
  cancelBuildBusy?: boolean;
}

type CheckStatus = 'pass' | 'fail' | 'skip' | 'pending' | string;

function statusIcon(status: CheckStatus): string {
  if (status === 'pass') return '✓';
  if (status === 'fail') return '✗';
  if (status === 'skip') return '–';
  return '○';
}

interface ChecklistItem {
  id?: string;
  status?: string;
  kind?: string;
  label?: string;
  detail?: string;
}

interface ChecklistPhase {
  id: string;
  status: string;
  label: string;
}

interface ChecklistData {
  attempt?: number;
  total?: number;
  passed?: boolean;
  failedPhase?: string;
  feedback?: string;
  phases?: ChecklistPhase[];
  items?: ChecklistItem[];
  suggestions?: string[];
  cost?: unknown;
}

interface IterationChecklistProps {
  checklist: ChecklistData;
  /** When false, hide per-symptom validation rows (logs are the primary view). */
  showValidationItems?: boolean;
}

function outcomeSummary(checklist: ChecklistData): string {
  const items = checklist.items || [];
  const passed = items.filter((i) => i.status === 'pass').length;
  const parts = [
    `Iteration ${checklist.attempt}/${checklist.total}`,
    checklist.passed ? 'passed' : checklist.failedPhase ? `failed at ${checklist.failedPhase}` : 'incomplete',
  ];
  if (items.length) parts.push(`${passed}/${items.length} checks`);
  return parts.join(' · ');
}

function IterationChecklist({ checklist, showValidationItems = false }: IterationChecklistProps): JSX.Element | null {
  if (!checklist) return null;
  return (
    <div className={`iteration-checklist ${checklist.passed ? 'passed' : 'failed'}`}>
      <div className="iteration-checklist-head">
        <span className="badge">
          Iteration {checklist.attempt}/{checklist.total}
          {checklist.passed ? ' · passed' : checklist.failedPhase ? ` · failed at ${checklist.failedPhase}` : ''}
        </span>
        {buildCostLabel(checklist.cost) && (
          <span className="pipeline-build-cost dim" title="Estimated LLM cost (code + validation agents)">
            {buildCostLabel(checklist.cost)}
          </span>
        )}
        {checklist.feedback && (
          <span className="feedback dim iteration-checklist-feedback">{checklist.feedback}</span>
        )}
      </div>
      <div className="checklist-section checklist-section--compact">
        <ul className="checklist checklist--inline">
          {(checklist.phases || []).map((p) => (
            <li key={p.id} className={`check-${p.status}`}>
              <span className="check-icon">{statusIcon(p.status)}</span>
              <span className="check-label">{p.label}</span>
            </li>
          ))}
        </ul>
      </div>
      {showValidationItems && (checklist.items || []).length > 0 && (
        <div className="checklist-section">
          <div className="checklist-section-title">Validation checks</div>
          <ul className="checklist">
            {(checklist.items || []).map((item, i) => (
              <li key={item.id ?? i} className={`check-${item.status}`}>
                <span className="check-icon">{statusIcon(item.status ?? 'pending')}</span>
                <span className="check-label">
                  {item.kind === 'step' && <span className="check-kind">check</span>}
                  {item.kind === 'judge' && <span className="check-kind">judge</span>}
                  {item.label}
                </span>
                {item.detail && <span className="check-detail">{item.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showValidationItems && Array.isArray(checklist.suggestions) && checklist.suggestions.length > 0 && (
        <ul className="suggestions">
          {checklist.suggestions.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
    </div>
  );
}

interface ValidationResult {
  passed: boolean;
  feedback?: string;
  suggestions?: string[];
  evidence?: unknown[];
}

interface ValidationCardProps {
  result: ValidationResult;
}

function ValidationCard({ result }: ValidationCardProps): JSX.Element | null {
  if (!result) return null;
  return (
    <div className={`validation-card ${result.passed ? 'passed' : 'failed'}`}>
      <div className="head">
        <span className="badge">{result.passed ? '✓ Passed' : '✗ Failed'}</span>
        <span className="feedback">{result.feedback}</span>
      </div>
      {Array.isArray(result.suggestions) && result.suggestions.length > 0 && (
        <ul className="suggestions">
          {result.suggestions.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
      {Array.isArray(result.evidence) && result.evidence.length > 0 && (
        <details>
          <summary>Evidence ({result.evidence.length} steps)</summary>
          <pre>{JSON.stringify(result.evidence, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

type BuildEvent = {
  type: string;
  message?: string;
  phase?: string;
  attempt?: number;
  label?: string;
  result?: ValidationResult;
  checklist?: ChecklistData;
  [key: string]: unknown;
};

export default function PipelinePage({
  draft, llmConfig, onDraftChanged, onGoReview, onCancelBuild, cancelBuildBusy,
}: PipelinePageProps): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const [running, setRunning] = useState<boolean>(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [latestChecklist, setLatestChecklist] = useState<ChecklistData | null>(null);
  const [checklistHistory, setChecklistHistory] = useState<ChecklistData[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [liveThinking, setLiveThinking] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [viewAttempt, setViewAttempt] = useState<number | null>(null);

  const allLogs = running ? logs : (draft?.buildLogs || logs);

  useEffect(() => {
    if (!draft) return;
    setStatus(draft.buildStatus || null);
    setAttempt(draft.buildCurrentAttempt || draft.buildAttempts || 0);
    setPhase(draft.buildCurrentPhase || null);
    setLogs(draft.buildLogs || []);
    setValidation((draft.buildValidation as ValidationResult) || null);
    setLatestChecklist((draft.buildLatestChecklist as ChecklistData) || null);
    setChecklistHistory((draft.buildChecklists as ChecklistData[]) || []);
  }, [
    draft?.id,
    draft?.buildStatus,
    draft?.buildLogs?.length,
    draft?.buildCurrentAttempt,
    draft?.buildAttempts,
    draft?.buildValidation,
    draft?.buildLatestChecklist,
    draft?.buildChecklists?.length,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const locationState = location.state as { focusAttempt?: number } | null;

  useEffect(() => {
    const focus = locationState?.focusAttempt ?? null;
    setViewAttempt(focus);
    if (focus == null) return undefined;
    const t = window.setTimeout(() => {
      document.getElementById('pipeline-logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(t);
  }, [locationState?.focusAttempt, draft?.id]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  const displayLogs = viewAttempt ? logsForAttempt(allLogs, viewAttempt) : allLogs;
  const viewChecklist = viewAttempt
    ? ((draft?.buildChecklists || []) as ChecklistData[]).find((c) => c.attempt === viewAttempt) ?? null
    : null;
  const inLogsView = viewAttempt != null;
  const effectiveStatus = running ? 'building' : (status || draft?.buildStatus || null);
  const buildSucceeded = effectiveStatus === 'review_ready' && !running;
  const isLiveBuild = running || effectiveStatus === 'building';
  const activeChecklist = viewChecklist ?? (latestChecklist || null);

  if (!draft) {
    return (
      <div className="authoring-empty">
        <div className="authoring-empty-icon" aria-hidden>⚙</div>
        <div className="authoring-empty-copy">
          <h2>Build pipeline</h2>
          <p>Select a draft from the library to run or inspect the AI build pipeline.</p>
        </div>
      </div>
    );
  }

  const draftReady = draft.draftReady ?? (
    !!(draft.draft?.brokenState?.rootCause)
    && !!(draft.draft?.infra?.services?.length)
    && !!(draft.draft?.description?.trim())
  );
  const llmReady = !!llmConfig?.llmConfigured;
  const maxAttempts = llmConfig?.maxIterations ?? 2;
  const hasWorkspace = !!(draft.buildFailedDir || draft.buildDir);
  const canRetry = effectiveStatus === 'failed'
    && !running
    && hasWorkspace;
  const canStartFresh = hasWorkspace && !running;
  const showStartBuild = !hasWorkspace && !running;
  const startDisabled = running || !draftReady || !llmReady;

  const runBuild = async (mode: 'retry' | 'fresh'): Promise<void> => {
    const isRetry = mode === 'retry';
    setRunning(true);
    setErr(null);
    if (!isRetry) {
      setLogs([]);
      setPhase(null);
      setAttempt(0);
      setValidation(null);
      setLatestChecklist(null);
      setChecklistHistory([]);
    } else {
      setLogs((prev) => [...prev, '--- Retrying build in same workspace ---']);
    }
    setStatus('building');
    setLiveThinking(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamBuild(draft.id, (ev: unknown) => {
        const event = ev as BuildEvent;
        if (event.type === 'log' && event.message) {
          setLiveThinking(null);
          setLogs((prev) => {
            const next = [...prev, event.message as string];
            return next.length > 1000 ? next.slice(next.length - 1000) : next;
          });
        } else if (event.type === 'thinking') {
          const label = typeof event.label === 'string' ? event.label : 'Thinking';
          setLiveThinking(label);
        } else if (event.type === 'codeStep') {
          setLiveThinking(null);
        } else if (event.type === 'codeDiff' && typeof event.diff === 'string') {
          setLiveThinking(null);
          const diffLines = formatCodeDiffLines({
            tool: typeof event.tool === 'string' ? event.tool : undefined,
            path: typeof event.path === 'string' ? event.path : undefined,
            diff: event.diff,
            summary: !!event.summary,
          });
          setLogs((prev) => {
            const next = [...prev, ...diffLines];
            return next.length > 1000 ? next.slice(next.length - 1000) : next;
          });
        } else if (event.type === 'phase') {
          setPhase(event.phase ?? null);
          setAttempt(event.attempt ?? 0);
        } else if (event.type === 'validation') {
          setValidation(event.result ?? null);
        } else if (event.type === 'checklist' && event.checklist) {
          setLatestChecklist(event.checklist);
          setChecklistHistory((prev) => {
            const next = [...prev, event.checklist as ChecklistData];
            return next.length > 20 ? next.slice(next.length - 20) : next;
          });
        } else if (event.type === 'done') {
          setStatus('review_ready');
        } else if (event.type === 'error') {
          setErr(event.message ?? 'Unknown error');
          setStatus('failed');
        }
      }, { signal: controller.signal, mode: isRetry ? 'retry' : 'fresh' });

      try {
        const fresh = await getProblemSession(draft.id) as ProblemSession;
        onDraftChanged(fresh);
      } catch (_e) { /* noop */ }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message);
    } finally {
      setRunning(false);
      setLiveThinking(null);
      abortRef.current = null;
    }
  };

  const checklistSummary = activeChecklist ? outcomeSummary(activeChecklist) : null;

  const logStream = (
    <PipelineLogStream
      lines={displayLogs}
      scrollKey={viewAttempt}
      thinking={running ? liveThinking : null}
    />
  );

  const outcomeDetails = activeChecklist && !isLiveBuild ? (
    <details className="pipeline-outcome-details">
      <summary>{checklistSummary || 'Build outcome'}</summary>
      <IterationChecklist checklist={activeChecklist} showValidationItems />
      {!viewAttempt && validation && <ValidationCard result={validation} />}
      {!viewAttempt && checklistHistory.length > 1 && (
        <details className="checklist-history">
          <summary>Previous iterations ({checklistHistory.length - 1})</summary>
          <div className="checklist-history-list">
            {[...checklistHistory].slice(0, -1).reverse().map((c) => (
              <IterationChecklist key={`iter-${c.attempt}`} checklist={c} showValidationItems />
            ))}
          </div>
        </details>
      )}
    </details>
  ) : null;

  return (
    <div className="pipeline-grid">
      <section className={`panel${isLiveBuild ? ' pipeline-panel--live' : ''}`}>
        <div className="panel-header">
          <div className="title">Build pipeline</div>
          <div className="right">
            {onCancelBuild && draft?.buildStatus === 'building' && !running && (
              <button
                type="button"
                className="ghost sm danger"
                onClick={onCancelBuild}
                disabled={cancelBuildBusy}
              >
                {cancelBuildBusy ? 'Cancelling…' : 'Cancel build'}
              </button>
            )}
            {running && (
              <button
                className="danger sm"
                onClick={() => { if (abortRef.current) abortRef.current.abort(); }}
              >
                Stop
              </button>
            )}
            {canRetry && (
              <button
                type="button"
                onClick={() => runBuild('retry')}
                disabled={startDisabled}
                title={!draftReady ? 'Draft incomplete' : !llmReady ? 'LLM not configured' : 'Continue in the same build folder'}
              >
                Retry build
              </button>
            )}
            {canStartFresh && (
              <button
                type="button"
                className={canRetry ? 'ghost sm' : undefined}
                onClick={() => runBuild('fresh')}
                disabled={startDisabled}
                title={
                  !draftReady
                    ? 'Draft incomplete (description, rootCause, infra.services)'
                    : !llmReady
                      ? 'LLM not configured'
                      : 'Discard current workspace and run in a new build folder'
                }
              >
                Start fresh
              </button>
            )}
            {showStartBuild && (
              <button
                type="button"
                onClick={() => runBuild('fresh')}
                disabled={startDisabled}
                title={
                  !draftReady
                    ? 'Draft incomplete (description, rootCause, infra.services)'
                    : !llmReady
                      ? 'LLM not configured'
                      : ''
                }
              >
                Start build
              </button>
            )}
          </div>
        </div>
        <div className={`panel-body pipeline-panel-body pipeline-panel-body--logs-first${isLiveBuild ? ' pipeline-panel-body--live' : ''}`}>
          {!isLiveBuild && draft.reviewFeedback && (
            <AuthorReviewFeedbackBanner feedback={draft.reviewFeedback} />
          )}
          <div className="pipeline-live-chrome">
            <PhaseTracker
              phase={phase}
              attempt={attempt}
              total={maxAttempts}
              status={effectiveStatus}
              validation={validation}
              running={running}
            />
          </div>
          {isLiveBuild ? (
            <>
              {err && <div className="alert pipeline-live-alert">{err}</div>}
              {logStream}
              {activeChecklist && (
                <details className="pipeline-live-checklist">
                  <summary>{checklistSummary || 'Build progress'}</summary>
                  <IterationChecklist checklist={activeChecklist} />
                </details>
              )}
            </>
          ) : (
            <>
              {buildSucceeded && !inLogsView && onGoReview && (
                <div className="pipeline-build-success" role="status">
                  <div className="pipeline-build-success-copy">
                    <strong>Build passed</strong>
                    <span className="dim">
                      Validation succeeded. Open Review to inspect the sandbox before shipping.
                    </span>
                  </div>
                  <button type="button" className="primary sm" onClick={onGoReview}>
                    Open review →
                  </button>
                </div>
              )}
              {effectiveStatus === 'changes_requested' && !running && (
                <div className="alert info pipeline-compact-alert">
                  Reviewer sent this build back with notes above. Update the draft or infra, then run{' '}
                  <strong>Start fresh</strong>.
                </div>
              )}
              {hasWorkspace && !running && !buildSucceeded && (
                <div className="alert info pipeline-compact-alert">
                  {effectiveStatus === 'failed' ? (
                    <>
                      Failed
                      {draft.buildFailedPhase && (
                        <span> at <code>{draft.buildFailedPhase}</code></span>
                      )}
                      {draft.buildFailedMsg && (
                        <span className="pipeline-failure-hint"> — {draft.buildFailedMsg}</span>
                      )}
                    </>
                  ) : effectiveStatus === 'building' ? (
                    <>Build may still be running — use Cancel or Start fresh.</>
                  ) : (
                    <>Workspace on disk — Start fresh for a new folder.</>
                  )}
                </div>
              )}
              {err && <div className="alert pipeline-compact-alert">{err}</div>}
              {viewAttempt != null && (
                <div className="pipeline-logs-banner alert info">
                  Showing logs for <strong>attempt {viewAttempt}</strong>
                  <button
                    type="button"
                    className="ghost sm"
                    onClick={() => {
                      setViewAttempt(null);
                      navigate(location.pathname, { replace: true, state: {} });
                    }}
                  >
                    Show all logs
                  </button>
                </div>
              )}
              {logStream}
              {outcomeDetails}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
