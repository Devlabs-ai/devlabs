import React, { useState } from 'react';
import { REVIEW_FEEDBACK_TAGS } from '../constants/reviewFeedbackTags.js';

export default function ReviewFeedbackPanel({ onSendBack, busy }) {
  const [observations, setObservations] = useState('');
  const [tags, setTags] = useState([]);
  const [severity, setSeverity] = useState('blocker');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleTag = (id) => {
    setTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = observations.trim();
    if (!text) {
      setError('Describe what you found in the sandbox.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSendBack({ observations: text, tags, severity });
      setObservations('');
      setTags([]);
      setSeverity('blocker');
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to send back');
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = busy || submitting;

  return (
    <form className="review-feedback" onSubmit={handleSubmit}>
      <div className="review-feedback-head">
        <h3 className="review-feedback-title">Reviewer observations</h3>
        <p className="review-feedback-lead">
          Flag issues the automated build missed (broken URLs, missing dashboards, brief mismatch, etc.).
        </p>
      </div>

      <label className="review-feedback-field">
        <span>What needs fixing?</span>
        <textarea
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          placeholder="e.g. Grafana loads but has no dashboards; storefront URL returns 404…"
          rows={4}
          disabled={disabled}
          required
        />
      </label>

      <fieldset className="review-feedback-tags">
        <legend>Areas (optional)</legend>
        <div className="review-feedback-tag-row">
          {REVIEW_FEEDBACK_TAGS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`filter-chip ${tags.includes(t.id) ? 'active' : ''}`}
              onClick={() => toggleTag(t.id)}
              disabled={disabled}
            >
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="review-feedback-severity">
        <legend>Severity</legend>
        <label className="review-feedback-radio">
          <input
            type="radio"
            name="review-severity"
            value="blocker"
            checked={severity === 'blocker'}
            onChange={() => setSeverity('blocker')}
            disabled={disabled}
          />
          <span>Blocker — must fix before shipping</span>
        </label>
        <label className="review-feedback-radio">
          <input
            type="radio"
            name="review-severity"
            value="suggestion"
            checked={severity === 'suggestion'}
            onChange={() => setSeverity('suggestion')}
            disabled={disabled}
          />
          <span>Suggestion — nice to fix</span>
        </label>
      </fieldset>

      {error && <div className="alert">{error}</div>}

      <button type="submit" className="sm review-feedback-submit" disabled={disabled}>
        {submitting ? 'Sending…' : 'Send back to author'}
      </button>
    </form>
  );
}
