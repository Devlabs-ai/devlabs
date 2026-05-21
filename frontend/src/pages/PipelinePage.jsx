import React, { useEffect, useRef, useState } from 'react';
import { streamBuild, getProblemSession } from '../services/problemApi.js';

const PHASES = ['GENERATE', 'WRITE', 'START', 'VALIDATE'];

function PhaseTracker({ phase, attempt, total, status, validation, running }) {
  // The run is finished once we know its terminal state. After this point
  // there are no more `phase` events, so we must mark VALIDATE done ourselves
  // (otherwise the pill stays stuck on "current"/blue even after the green
  // PASSED card appears).
  const finished = !running
    && (status === 'review_ready' || status === 'failed' || !!validation);
  const phaseIdx = PHASES.indexOf(phase || '');

  return (
    <div className="phase-tracker">
      <div className="phase-row">
        {PHASES.map((p, idx) => {
          let done = phaseIdx > idx;
          let isCurrent = !finished && p === phase;
          if (finished) {
            // VALIDATE: green if the LLM judge passed, red if it failed.
            // Earlier phases: green if we reached them at all this iteration.
            if (p === 'VALIDATE') {
              done = !!validation?.passed || status === 'review_ready';
            } else {
              done = idx <= phaseIdx;
            }
          }
          const failed = finished && p === 'VALIDATE' && validation && !validation.passed;
          return (
            <div
              key={p}
              className={`phase-pill ${isCurrent ? 'current' : ''} ${done ? 'done' : ''} ${failed ? 'failed' : ''}`}
            >
              <span className="dot" />
              {p}
            </div>
          );
        })}
      </div>
      <div className="phase-meta">
        <span>Attempt {attempt || 0} / {total || 5}</span>
        <span className={`status-pill ${status || 'idle'}`}>{status || 'idle'}</span>
      </div>
    </div>
  );
}

function LogStream({ lines }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);
  return (
    <div className="log-stream" ref={ref}>
      {lines.length === 0 && <div className="log-empty">Logs will appear here once the build starts.</div>}
      {lines.map((l, i) => <div key={i} className="log-line">{l}</div>)}
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

export default function PipelinePage({ draft, llmConfig, onDraftChanged, onGoReview }) {
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [logs, setLogs] = useState([]);
  const [validation, setValidation] = useState(null);
  const [status, setStatus] = useState(null); // 'building' | 'review_ready' | 'failed'
  const [err, setErr] = useState(null);
  const abortRef = useRef(null);

  // hydrate from draft state when switching tabs
  useEffect(() => {
    if (!draft) return;
    setStatus(draft.buildStatus || null);
    setAttempt(draft.buildCurrentAttempt || draft.buildAttempts || 0);
    setPhase(draft.buildCurrentPhase || null);
    setLogs(draft.buildLogs || []);
    setValidation(draft.buildValidation || null);
  }, [draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

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

  const hasSandboxSpec = !!draft.draft?.sandboxSpec;
  const llmReady = !!llmConfig?.llmConfigured;
  const startDisabled = running || !hasSandboxSpec || !llmReady;

  const start = async () => {
    setRunning(true);
    setErr(null);
    setLogs([]);
    setPhase(null);
    setAttempt(0);
    setValidation(null);
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
            {status === 'review_ready' && (
              <button className="primary sm" onClick={onGoReview}>Open Review →</button>
            )}
            <button
              onClick={start}
              disabled={startDisabled}
              title={!hasSandboxSpec ? 'No sandboxSpec on the draft' : !llmReady ? 'LLM not configured' : ''}
            >
              {running ? 'Running…' : status === 'review_ready' ? 'Rebuild' : 'Start build'}
            </button>
          </div>
        </div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
          <PhaseTracker
            phase={phase}
            attempt={attempt}
            total={5}
            status={status}
            validation={validation}
            running={running}
          />
          {err && <div className="alert">{err}</div>}
          {validation && <ValidationCard result={validation} />}
          <LogStream lines={logs} />
        </div>
      </section>
    </div>
  );
}
