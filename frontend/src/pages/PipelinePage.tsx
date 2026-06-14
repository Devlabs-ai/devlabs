import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PhaseTracker } from '../components/PhaseTracker';
import AuthorReviewFeedbackBanner from '../components/AuthorReviewFeedbackBanner';
import { streamBuild, getProblemSession } from '../services/problemApi';
import { logsForAttempt } from '../utils/buildLogFilter';
import { buildCostLabel } from '../utils/buildCost';
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

function logLineClass(line: string): string {
  if (line.includes('✗') || line.includes(' FAIL') || line.includes('failed')) return 'log-error';
  if (line.includes('✓') || line.includes(' PASS') || line.includes('passed')) return 'log-ok';
  if (line.includes('⚠')) return 'log-warn';
  if (line.includes('►')) return 'log-phase';
  return '';
}

interface LogStreamProps {
  lines: string[];
  scrollKey: number | null;
}

function LogStream({ lines, scrollKey }: LogStreamProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length, scrollKey]);
  return (
    <div id="pipeline-logs" className="log-stream" ref={ref}>
      {lines.length === 0 && <div className="log-empty">Logs will appear here once the build starts.</div>}
      {lines.map((l, i) => (
        <div key={i} className={`log-line ${logLineClass(l)}`}>{l}</div>
      ))}
    </div>
  );
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
}

function IterationChecklist({ checklist }: IterationChecklistProps): JSX.Element | null {
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
        {checklist.feedback && <span className="feedback dim">{checklist.feedback}</span>}
      </div>
      <div className="checklist-section">
        <div className="checklist-section-title">Pipeline phases</div>
        <ul className="checklist">
          {(checklist.phases || []).map((p) => (
            <li key={p.id} className={`check-${p.status}`}>
              <span className="check-icon">{statusIcon(p.status)}</span>
              <span className="check-label">{p.label}</span>
            </li>
          ))}
        </ul>
      </div>
      {(checklist.items || []).length > 0 && (
        <div className="checklist-section">
          <div className="checklist-section-title">Validation checklist</div>
          <ul className="checklist">
            {(checklist.items || []).map((item, i) => (
              <li key={item.id ?? i} className={`check-${item.status}`}>
                <span className="check-icon">{statusIcon(item.status ?? 'pending')}</span>
                <span className="check-label">
                  {item.kind === 'symptom' && <span className="check-kind">symptom</span>}
                  {item.kind === 'step' && <span className="check-kind">step</span>}
                  {item.kind === 'judge' && <span className="check-kind">judge</span>}
                  {item.label}
                </span>
                {item.detail && <span className="check-detail">{item.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(checklist.suggestions) && checklist.suggestions.length > 0 && (
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
  const maxAttempts = llmConfig?.maxIterations ?? 10;
  const startDisabled = running || !draftReady || !llmReady;

  const start = async (): Promise<void> => {
    setRunning(true);
    setErr(null);
    setLogs([]);
    setPhase(null);
    setAttempt(0);
    setValidation(null);
    setLatestChecklist(null);
    setChecklistHistory([]);
    setStatus('building');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamBuild(draft.id, (ev: unknown) => {
        const event = ev as BuildEvent;
        if (event.type === 'log' && event.message) {
          setLogs((prev) => {
            const next = [...prev, event.message as string];
            return next.length > 1000 ? next.slice(next.length - 1000) : next;
          });
        } else if (event.type === 'tool') {
          const name = (event as { name?: string }).name || 'tool';
          const preview = (event as { argsPreview?: string }).argsPreview;
          const resultPreview = (event as { resultPreview?: string }).resultPreview;
          const parts = [`Tool ${name}`];
          if (preview) parts.push(preview);
          if (resultPreview) parts.push(`→ ${resultPreview}`);
          const line = parts.join(': ');
          setLogs((prev) => {
            const next = [...prev, line];
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
      }, { signal: controller.signal });

      try {
        const fresh = await getProblemSession(draft.id) as ProblemSession;
        onDraftChanged(fresh);
      } catch (_e) { /* noop */ }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="pipeline-grid">
      <section className="panel">
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
            <button
              onClick={start}
              disabled={startDisabled}
              title={!draftReady ? 'Draft incomplete (description, rootCause, infra.services)' : !llmReady ? 'LLM not configured' : ''}
            >
              {running ? 'Running…' : buildSucceeded ? 'Rebuild' : (draft.buildFailedDir ? 'Resume build' : 'Start build')}
            </button>
          </div>
        </div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
          {draft.reviewFeedback && (
            <AuthorReviewFeedbackBanner feedback={draft.reviewFeedback} />
          )}
          <PhaseTracker
            phase={phase}
            attempt={attempt}
            total={maxAttempts}
            status={effectiveStatus}
            validation={validation}
            running={running}
          />
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
            <div className="alert info">
              Reviewer sent this build back with notes above. Update the draft or infra, then run{' '}
              <strong>Rebuild</strong>.
            </div>
          )}
          {draft.buildFailedDir && !running && !buildSucceeded && (
            <div className="alert info">
              Previous failed build preserved — clicking <strong>Resume build</strong> will reuse
              its generated assets as a starting point for the new run.
              {draft.buildFailedPhase && (
                <span style={{ marginLeft: 6 }}>Last failure: <code>{draft.buildFailedPhase}</code></span>
              )}
            </div>
          )}
          {err && <div className="alert">{err}</div>}
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
          {viewChecklist ? (
            <IterationChecklist checklist={viewChecklist} />
          ) : latestChecklist && <IterationChecklist checklist={latestChecklist} />}
          {!viewAttempt && validation && <ValidationCard result={validation} />}
          {!viewAttempt && checklistHistory.length > 1 && (
            <details className="checklist-history">
              <summary>Previous iterations ({checklistHistory.length - 1})</summary>
              <div className="checklist-history-list">
                {[...checklistHistory].slice(0, -1).reverse().map((c) => (
                  <IterationChecklist key={`iter-${c.attempt}`} checklist={c} />
                ))}
              </div>
            </details>
          )}
          <LogStream lines={displayLogs} scrollKey={viewAttempt} />
        </div>
      </section>
    </div>
  );
}
