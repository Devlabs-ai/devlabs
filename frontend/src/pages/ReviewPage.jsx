import React, { useEffect, useState, useCallback } from 'react';
import { listReviews, pushReview, dismissReview } from '../services/reviewApi.js';
import { BUCKETS } from '../constants/buckets.js';

function ReviewRow({ r, active, onClick }) {
  return (
    <button className={`review-row ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="title">{r.title || r.builtChallenge?.title || '(untitled)'}</div>
      <div className="meta">
        <span className={`pill ${r.buildValidation?.passed ? 'pass' : 'fail'}`}>
          {r.buildValidation?.passed ? 'validation ✓' : 'validation ✗'}
        </span>
        <span className="dim">{new Date(r.savedAt).toLocaleString()}</span>
      </div>
    </button>
  );
}

function ReviewDetail({ r, onPush, onDismiss, busy, bucket, onBucketChange }) {
  if (!r) {
    return <div className="review-empty">Pick a build from the list to inspect it.</div>;
  }
  const c = r.builtChallenge || {};
  const canPush = !busy && r.buildValidation?.passed && !!bucket;
  return (
    <div className="review-detail">
      <header>
        <div>
          <h3>{c.title || r.title}</h3>
          <p className="dim">{c.description}</p>
        </div>
        <div className="actions">
          <div className="review-bucket-picker">
            <label htmlFor="review-bucket">Push to</label>
            <select
              id="review-bucket"
              value={bucket || ''}
              onChange={(e) => onBucketChange(e.target.value || null)}
              disabled={busy}
            >
              <option value="">Pick a bucket…</option>
              {BUCKETS.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </div>
          <button className="ghost danger" onClick={() => onDismiss(r.sessionId)} disabled={busy}>Dismiss</button>
          <button onClick={() => onPush(r.sessionId)} disabled={!canPush}>
            {busy ? 'Pushing…' : 'Push to verified'}
          </button>
        </div>
      </header>

      <div className="kv-grid">
        <div><span className="label">Difficulty</span><span>{c.difficulty || '—'}</span></div>
        <div><span className="label">Category</span><span>{c.category || '—'}</span></div>
        <div><span className="label">Tags</span><span>{(c.tags || []).join(', ') || '—'}</span></div>
        <div><span className="label">Build dir</span><code className="path">{r.buildDir || '—'}</code></div>
      </div>

      {c.metrics?.observed?.values && Object.keys(c.metrics.observed.values).length > 0 && (
        <section>
          <h4>Observed metrics (baseline)</h4>
          <ul className="suggestions">
            {Object.entries(c.metrics.observed.values)
              .filter(([, v]) => v?.value != null)
              .map(([id, v]) => (
                <li key={id}><strong>{id}</strong>: {v.value}</li>
              ))}
          </ul>
          <p className="dim">
            {c.metrics.observed.sampleCount} samples from {c.metrics.observed.service}
          </p>
        </section>
      )}

      {r.buildValidation && (
        <section>
          <h4>Validation</h4>
          <div className={`validation-card ${r.buildValidation.passed ? 'passed' : 'failed'}`}>
            <div className="head">
              <span className="badge">{r.buildValidation.passed ? '✓ Passed' : '✗ Failed'}</span>
              <span className="feedback">{r.buildValidation.feedback}</span>
            </div>
            {Array.isArray(r.buildValidation.suggestions) && r.buildValidation.suggestions.length > 0 && (
              <ul className="suggestions">
                {r.buildValidation.suggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
          </div>
        </section>
      )}

      {c.problemStatement && (
        <section>
          <h4>Problem statement</h4>
          <div className="kv-grid">
            <div><span className="label">Incident</span><span>{c.problemStatement.incident}</span></div>
            <div><span className="label">Severity</span><span>{c.problemStatement.severity}</span></div>
            <div className="full"><span className="label">Situation</span><span>{c.problemStatement.situation}</span></div>
          </div>
          {Array.isArray(c.problemStatement.tasks) && (
            <>
              <span className="label">Tasks</span>
              <ol>{c.problemStatement.tasks.map((t, i) => <li key={i}>{t}</li>)}</ol>
            </>
          )}
        </section>
      )}

      <section>
        <h4>Raw artefacts</h4>
        <details>
          <summary>challenge.json</summary>
          <pre>{JSON.stringify(c, null, 2)}</pre>
        </details>
        <details>
          <summary>validationSpec</summary>
          <pre>{JSON.stringify(c.validationSpec, null, 2)}</pre>
        </details>
      </section>
    </div>
  );
}

export default function ReviewPage({ onPromoted, refreshKey }) {
  const [reviews, setReviews] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Per-review bucket selection so switching between rows doesn't blow away
  // a choice the reviewer already made on another card.
  const [buckets, setBuckets] = useState({});

  const reload = useCallback(async () => {
    try {
      const list = await listReviews();
      setReviews(list);
      if (!list.some((r) => r.sessionId === activeId)) {
        setActiveId(list[0]?.sessionId || null);
      }
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  }, [activeId]);

  useEffect(() => { reload(); }, [reload, refreshKey]);

  const active = reviews.find((r) => r.sessionId === activeId) || null;
  const activeBucket = active ? buckets[active.sessionId] || null : null;

  const handleBucketChange = (value) => {
    if (!active) return;
    setBuckets((prev) => ({ ...prev, [active.sessionId]: value }));
  };

  const handlePush = async (id) => {
    const bucket = buckets[id];
    if (!bucket) {
      setErr('Pick a bucket before pushing this challenge to verified.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const out = await pushReview(id, { bucket });
      if (onPromoted) onPromoted(out.slug);
      setBuckets((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await reload();
      setActiveId(null);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async (id) => {
    setBusy(true);
    setErr(null);
    try {
      await dismissReview(id);
      await reload();
      setActiveId(null);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review-grid">
      <aside className="review-list-col panel">
        <div className="panel-header">
          <div className="title">Review queue</div>
          <span className="meta">{reviews.length} pending</span>
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          {err && <div className="alert" style={{ margin: 14 }}>{err}</div>}
          {reviews.length === 0 ? (
            <div className="review-empty">No builds awaiting review. Finish a build in the pipeline tab.</div>
          ) : (
            reviews.map((r) => (
              <ReviewRow
                key={r.sessionId}
                r={r}
                active={r.sessionId === activeId}
                onClick={() => setActiveId(r.sessionId)}
              />
            ))
          )}
        </div>
      </aside>

      <section className="review-detail-col panel">
        <div className="panel-header">
          <div className="title">Build artefacts</div>
        </div>
        <div className="panel-body" style={{ overflow: 'auto' }}>
          <ReviewDetail
            r={active}
            onPush={handlePush}
            onDismiss={handleDismiss}
            busy={busy}
            bucket={activeBucket}
            onBucketChange={handleBucketChange}
          />
        </div>
      </section>
    </div>
  );
}
