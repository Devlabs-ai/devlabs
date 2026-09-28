import React, { useCallback, useEffect, useState } from 'react';
import {
  deleteChallengeReview,
  fetchChallengeReviews,
  postChallengeReview,
  type ChallengeReview,
} from '../services/challengeApi';
import { getCurrentUser, isAdminUser } from '../services/authApi';
import { useAppState } from '../context/AppStateContext';

interface ChallengeReviewPanelProps {
  challengeId: string;
}

function formatWhen(ts: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

export default function ChallengeReviewPanel({
  challengeId,
}: ChallengeReviewPanelProps): JSX.Element {
  const { currentUser } = useAppState();
  const me = currentUser || getCurrentUser();
  const myId = me?.id || '';
  const isAdmin = isAdminUser(me);

  const [reviews, setReviews] = useState<ChallengeReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReviews(await fetchChallengeReviews(challengeId));
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error || err.message || 'Could not load feedback');
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onPost(): Promise<void> {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    setError(null);
    try {
      const review = await postChallengeReview(challengeId, body);
      setReviews((prev) => [...prev, review]);
      setDraft('');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error || err.message || 'Could not post feedback');
    } finally {
      setPosting(false);
    }
  }

  async function onDelete(reviewId: string): Promise<void> {
    setDeletingId(reviewId);
    setError(null);
    try {
      await deleteChallengeReview(challengeId, reviewId);
      setReviews((prev) => prev.filter((r) => r.id !== reviewId));
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error || err.message || 'Could not delete');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="challenge-review-panel">
      <h3 className="challenge-staff-title">Review</h3>
      <p className="challenge-staff-lead">
        Feedback from reviewers and admins. Learners never see this tab.
      </p>

      {loading ? <p className="challenge-staff-status">Loading…</p> : null}
      {error ? (
        <p className="challenge-staff-status challenge-staff-status--error">{error}</p>
      ) : null}

      {!loading && reviews.length === 0 ? (
        <p className="challenge-staff-status">No feedback yet.</p>
      ) : null}

      {reviews.length > 0 ? (
        <ul className="challenge-review-list">
          {reviews.map((r) => {
            const canDelete = isAdmin || r.authorId === myId;
            return (
              <li key={r.id} className="challenge-review-item">
                <div className="challenge-review-meta">
                  <strong>{r.authorEmail || r.authorName || 'Reviewer'}</strong>
                  <span>{formatWhen(r.createdAt)}</span>
                </div>
                <p className="challenge-review-body">{r.body}</p>
                {canDelete ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn--reject"
                    disabled={deletingId === r.id}
                    onClick={() => void onDelete(r.id)}
                  >
                    {deletingId === r.id ? '…' : 'Delete'}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="challenge-review-compose">
        <label className="challenge-staff-title" htmlFor={`review-draft-${challengeId}`}>
          Add feedback
        </label>
        <textarea
          id={`review-draft-${challengeId}`}
          className="challenge-review-textarea"
          rows={5}
          value={draft}
          placeholder="Notes for the team…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="challenge-staff-actions">
          <button
            type="button"
            className="admin-btn admin-btn--approve"
            disabled={posting || !draft.trim()}
            onClick={() => void onPost()}
          >
            {posting ? 'Posting…' : 'Post feedback'}
          </button>
        </div>
      </div>
    </div>
  );
}
