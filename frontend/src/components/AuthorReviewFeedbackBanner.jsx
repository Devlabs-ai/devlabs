import React from 'react';
import { tagLabel } from '../constants/reviewFeedbackTags.js';

function formatWhen(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch (_e) {
    return '';
  }
}

export default function AuthorReviewFeedbackBanner({ feedback }) {
  if (!feedback?.observations) return null;

  const severity = feedback.severity === 'suggestion' ? 'Suggestion' : 'Blocker';

  return (
    <div className="author-review-feedback-banner">
      <div className="author-review-feedback-banner-head">
        <span className={`pill sm ${feedback.severity === 'suggestion' ? 'preview' : 'fail'}`}>
          Review feedback · {severity}
        </span>
        {feedback.submittedAt && (
          <span className="dim">{formatWhen(feedback.submittedAt)}</span>
        )}
      </div>
      {Array.isArray(feedback.tags) && feedback.tags.length > 0 && (
        <div className="author-review-feedback-tags">
          {feedback.tags.map((t) => (
            <span key={t} className="review-meta-chip review-meta-chip--tag">{tagLabel(t)}</span>
          ))}
        </div>
      )}
      <p className="author-review-feedback-body">{feedback.observations}</p>
    </div>
  );
}
