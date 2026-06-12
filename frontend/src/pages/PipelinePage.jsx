import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PhaseTracker } from '../components/PhaseTracker.jsx';
import AuthorReviewFeedbackBanner from '../components/AuthorReviewFeedbackBanner.jsx';
import { streamBuild, getProblemSession } from '../services/problemApi.js';
import { logsForAttempt } from '../utils/buildLogFilter.js';
import { buildCostLabel } from '../utils/buildCost.js';

function logLineClass(line) {
  if (line.includes('✗') || line.includes(' FAIL') || line.includes('failed')) return 'log-error';
  if (line.includes('✓') || line.includes(' PASS') || line.includes('passed')) return 'log-ok';
  if (line.includes('⚠')) return 'log-warn';
  if (line.includes('►')) return 'log-phase';
  return '';
}

function LogStream({ lines, scrollKey }) {
  const ref = useRef(null);
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

function statusIcon(status) {
  if (status === 'pass') return '✓';
  if (status === 'fail') return '✗';
  if (status === 'skip') return '–';
  return '○';
}

function IterationChecklist({ checklist }) {
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
            {checklist.items.map((item) => (
              <li key={item.id} className={`check-${item.status}`}>
                <span className="check-icon">{statusIcon(item.status)}</span>
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

function ValidationCard({ result }) {
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

export default function PipelinePage({
  draft, llmConfig, onDraftChanged, onGoReview, onCancelBuild, cancelBuildBusy,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [logs, setLogs] = useState([]);
  const [validation, setValidation] = useState(null);
  const [latestChecklist, setLatestChecklist] = useState(null);
  const [checklistHistory, setChecklistHistory] = useState([]);
  const [status, setStatus] = useState(null); // 'building' | 'review_ready' | 'failed'
  const [err, setErr] = useState(null);
  const abortRef = useRef(null);
  const [viewAttempt, setViewAttempt] = useState(null);

  const allLogs = running ? logs : (draft?.buildLogs || logs);

  // hydrate from draft state when switching tabs
  useEffect(() => {
    if (!draft) return;
    setStatus(draft.buildStatus || null);
    setAttempt(draft.buildCurrentAttempt || draft.buildAttempts || 0);
    setPhase(draft.buildCurrentPhase || null);
    setLogs(draft.buildLogs || []);
    setValidation(draft.buildValidation || null);
    setLatestChecklist(draft.buildLatestChecklist || null);
    setChecklistHistory(draft.buildChecklists || []);
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

  useEffect(() => {
    const focus = location.state?.focusAttempt;
    setViewAttempt(focus ?? null);
    if (focus == null) return undefined;
    const t = window.setTimeout(() => {
      document.getElementById('pipeline-logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(t);
  }, [location.state?.focusAttempt, draft?.id]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  const displayLogs = viewAttempt ? logsForAttempt(allLogs, viewAttempt) : allLogs;
  const viewChecklist = viewAttempt
    ? (draft?.buildChecklists || []).find((c) => c.attempt === viewAttempt)
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
    !!draft.draft?.brokenState?.rootCause
    && !!draft.draft?.infra?.services?.length
    && !!draft.draft?.description?.trim()
  );
  const llmReady = !!llmConfig?.llmConfigured;
  const maxAttempts = llmConfig?.maxIterations ?? 10;
  const startDisabled = running || !draftReady || !llmReady;

  const start = async () => {
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
      await streamBuild(draft.id, (ev) => {
        if (ev.type === 'log' && ev.message) {
          setLogs((prev) => {
            const next = [...prev, ev.message];
            return next.length > 1000 ? next.slice(next.length - 1000) : next;
          });
        } else if (ev.type === 'phase') {
          setPhase(ev.phase);
          setAttempt(ev.attempt);
        } else if (ev.type === 'validation') {
          setValidation(ev.result);
        } else if (ev.type === 'checklist' && ev.checklist) {
          setLatestChecklist(ev.checklist);
          setChecklistHistory((prev) => {
            const next = [...prev, ev.checklist];
            return next.length > 20 ? next.slice(next.length - 20) : next;
          });
        } else if (ev.type === 'done') {
          setStatus('review_ready');
        } else if (ev.type === 'error') {
          setErr(ev.message);
          setStatus('failed');
        }
      }, { signal: controller.signal });

      // sync the canonical draft from the server (which has buildSessionId + builtChallenge)
      try {
        const fresh = await getProblemSession(draft.id);
        onDraftChanged(fresh);
      } catch (_e) { /* noop */ }
    } catch (e) {
      if (e.name !== 'AbortError') setErr(e.message);
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
