import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listReviews,
  pushReview,
  dismissReview,
  sendBackReview,
} from '../services/reviewApi.js';
import ReviewActionBar from '../components/ReviewActionBar.jsx';
import ReviewFeedbackPanel from '../components/ReviewFeedbackPanel.jsx';
import MarkdownProse from '../components/MarkdownProse.jsx';
import {
  bucketLabel,
  clearReviewSignoff,
  getReviewSignoff,
  resolvePushBucket,
  setReviewSignoff,
} from '../utils/reviewHelpers.js';

function ReviewRow({ r, active, onClick }) {
  const passed = !!r.buildValidation?.passed;
  const bucket = resolvePushBucket(r);
  const title = r.title || r.builtChallenge?.title || '(untitled)';
  const signoff = getReviewSignoff(r.sessionId);
  return (
    <button type="button" className={`review-row ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="title">{title}</div>
      <div className="meta">
        <span className={`pill ${passed ? 'pass' : 'fail'}`}>
          {passed ? 'validation ✓' : 'validation ✗'}
        </span>
        {signoff.touched && <span className="pill sm preview">sandbox</span>}
        {r.builtChallenge?.difficulty && (
          <span className="dim">{r.builtChallenge.difficulty}</span>
        )}
        {bucketLabel(bucket) && (
          <span className="dim">{bucketLabel(bucket)}</span>
        )}
        <span className="dim">{new Date(r.savedAt).toLocaleString()}</span>
      </div>
    </button>
  );
}

function ReviewMetaChips({ r }) {
  const c = r.builtChallenge || {};
  const passed = !!r.buildValidation?.passed;
  const tags = c.tags || [];

  return (
    <div className="review-meta-chips">
      <span className={`pill sm ${passed ? 'pass' : 'fail'}`}>
        {passed ? 'Build passed' : 'Build failed'}
      </span>
      {c.difficulty && <span className="review-meta-chip">{c.difficulty}</span>}
      {c.category && <span className="review-meta-chip">{c.category}</span>}
      {tags.map((t) => (
        <span key={t} className="review-meta-chip review-meta-chip--tag">{t}</span>
      ))}
    </div>
  );
}

function ReviewDetail({ r, onSendBack, feedbackBusy }) {
  if (!r) {
    return <div className="review-empty">Pick a build from the queue to review it.</div>;
  }

  const c = r.builtChallenge || {};
  const bucket = resolvePushBucket(r);

  return (
    <div className="review-detail review-detail--clean">
      {c.description && (
        <details className="review-panel" open>
          <summary>Candidate brief</summary>
          <div className="review-panel-body review-brief">
            <MarkdownProse text={c.description} className="markdown-prose" />
          </div>
        </details>
      )}

      {r.buildValidation && (
        <details className="review-panel">
          <summary>Automated validation</summary>
          <div className="review-panel-body">
            <p className="review-validation-feedback">{r.buildValidation.feedback}</p>
            {Array.isArray(r.buildValidation.suggestions) && r.buildValidation.suggestions.length > 0 && (
              <ul className="review-validation-list">
                {r.buildValidation.suggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
          </div>
        </details>
      )}

      <details className="review-panel">
        <summary>Technical details</summary>
        <div className="review-panel-body">
          <dl className="review-facts">
            {bucketLabel(bucket) && (
              <div>
                <dt>Library</dt>
                <dd>{bucketLabel(bucket)}</dd>
              </div>
            )}
            {r.buildDir && (
              <div>
                <dt>Build dir</dt>
                <dd><code className="path">{r.buildDir}</code></dd>
              </div>
            )}
          </dl>
          <details className="review-nested">
            <summary>challenge.json</summary>
            <pre>{JSON.stringify(c, null, 2)}</pre>
          </details>
        </div>
      </details>

      <ReviewFeedbackPanel onSendBack={onSendBack} busy={feedbackBusy} />
    </div>
  );
}

export default function ReviewPage({
  onPromoted,
  refreshKey,
  initialSessionId = null,
  returnState = null,
}) {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState([]);
  const [activeId, setActiveId] = useState(initialSessionId);
  const [listQuery, setListQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [signoffRev, setSignoffRev] = useState(0);

  const signoffFor = (id) => {
    void signoffRev;
    return id ? getReviewSignoff(id) : { touched: false, validated: false };
  };

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

  useEffect(() => {
    if (initialSessionId) setActiveId(initialSessionId);
  }, [initialSessionId]);

  useEffect(() => {
    if (returnState?.sessionId) {
      setActiveId(returnState.sessionId);
      if (returnState.sandboxTouched) {
        setReviewSignoff(returnState.sessionId, { touched: true });
      }
    }
  }, [returnState]);

  const active = reviews.find((r) => r.sessionId === activeId) || null;
  const activeSignoff = signoffFor(active?.sessionId);
  const q = listQuery.trim().toLowerCase();
  const filteredReviews = q
    ? reviews.filter((r) => {
        const title = (r.title || r.builtChallenge?.title || '').toLowerCase();
        const cat = (r.builtChallenge?.category || '').toLowerCase();
        return title.includes(q) || cat.includes(q);
      })
    : reviews;

  const selectReview = (sessionId) => {
    setActiveId(sessionId);
    setErr(null);
  };

  const handlePush = async (id) => {
    const review = reviews.find((r) => r.sessionId === id);
    const bucket = review ? resolvePushBucket(review) : null;
    if (!bucket) {
      setErr('Could not determine library bucket for this challenge.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const out = await pushReview(id, { bucket });
      clearReviewSignoff(id);
      if (onPromoted) onPromoted(out.slug);
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
      clearReviewSignoff(id);
      await reload();
      setActiveId(null);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendBack = async ({ observations, tags, severity }) => {
    if (!active?.sessionId) return;
    setFeedbackBusy(true);
    setErr(null);
    try {
      await sendBackReview(active.sessionId, { observations, tags, severity });
      clearReviewSignoff(active.sessionId);
      await reload();
      setActiveId(null);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
      throw e;
    } finally {
      setFeedbackBusy(false);
    }
  };

  const handleOpenSandbox = (reviewSessionId) => {
    navigate(`/review/${reviewSessionId}/sandbox`);
  };

  const handleSignoffChange = (checked) => {
    if (!active) return;
    setReviewSignoff(active.sessionId, { validated: checked });
    setSignoffRev((n) => n + 1);
  };

  const activeTitle = active?.builtChallenge?.title || active?.title;

  return (
    <div className="review-grid">
      <aside className="review-list-col panel">
        <div className="panel-header">
          <div className="title">Queue</div>
          <span className="meta">
            {filteredReviews.length === reviews.length
              ? `${reviews.length} pending`
              : `${filteredReviews.length} of ${reviews.length}`}
          </span>
        </div>
        {reviews.length > 0 && (
          <div className="review-list-search">
            <input
              type="search"
              className="review-list-search-input"
              placeholder="Filter by title or category…"
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              aria-label="Filter review queue"
            />
          </div>
        )}
        <div className="panel-body review-list-body">
          {reviews.length === 0 ? (
            <div className="review-empty">No builds awaiting review.</div>
          ) : filteredReviews.length === 0 ? (
            <div className="review-empty">No matches for &ldquo;{listQuery}&rdquo;.</div>
          ) : (
            filteredReviews.map((r) => (
              <ReviewRow
                key={r.sessionId}
                r={r}
                active={r.sessionId === activeId}
                onClick={() => selectReview(r.sessionId)}
              />
            ))
          )}
        </div>
      </aside>

      <section className="review-right-col panel">
        {err && <div className="review-detail-alert alert">{err}</div>}
        {active ? (
          <div className="review-detail-header">
            <div className="review-detail-header-text">
              <h2 className="review-detail-title">{activeTitle}</h2>
              <ReviewMetaChips r={active} />
            </div>
            <ReviewActionBar
              r={active}
              onPush={handlePush}
              onDismiss={handleDismiss}
              onOpenSandbox={handleOpenSandbox}
              busy={busy}
              sandboxValidated={activeSignoff.validated}
              onSandboxValidatedChange={handleSignoffChange}
              sandboxTouched={activeSignoff.touched}
            />
          </div>
        ) : (
          <div className="panel-header review-detail-col-header">
            <div className="title">Review</div>
          </div>
        )}
        <div className="panel-body review-right-body">
          <ReviewDetail
            r={active}
            onSendBack={handleSendBack}
            feedbackBusy={busy || feedbackBusy}
          />
        </div>
      </section>
    </div>
  );
}
