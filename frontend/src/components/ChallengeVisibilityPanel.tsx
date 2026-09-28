import React, { useState } from 'react';
import {
  fetchCatalogSettingsLocked,
  saveChallengeVisibility,
  type ChallengeVisibleTo,
} from '../services/challengeApi';

interface ChallengeVisibilityPanelProps {
  challengeId: string;
  visibleTo: ChallengeVisibleTo;
  visibilityNotes?: string;
  tokens?: number;
  onSaved?: (next: {
    visibleTo: ChallengeVisibleTo;
    visibilityNotes: string;
    tokens: number;
  }) => void;
}

const DEFAULT_VISIBLE_TO: ChallengeVisibleTo = 'admin';
const DEFAULT_TOKENS = 10;

const OPTIONS: Array<{ value: ChallengeVisibleTo; label: string; help: string }> = [
  {
    value: 'admin',
    label: 'Admin',
    help: 'Only admins can open this challenge.',
  },
  {
    value: 'reviewers',
    label: 'Reviewers',
    help: 'Reviewers and admins can open this challenge.',
  },
  {
    value: 'users',
    label: 'Users',
    help: 'Learners, reviewers, and admins can open this challenge.',
  },
];

export default function ChallengeVisibilityPanel({
  challengeId,
  visibleTo,
  visibilityNotes = '',
  tokens = DEFAULT_TOKENS,
  onSaved,
}: ChallengeVisibilityPanelProps): JSX.Element {
  const [value, setValue] = useState<ChallengeVisibleTo>(visibleTo || DEFAULT_VISIBLE_TO);
  const [notes, setNotes] = useState(visibilityNotes || '');
  const [tokensDraft, setTokensDraft] = useState(String(tokens ?? DEFAULT_TOKENS));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetchCatalogSettingsLocked()
      .then((v) => {
        if (!cancelled) setLocked(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    setValue(visibleTo || DEFAULT_VISIBLE_TO);
    setNotes(visibilityNotes || '');
    setTokensDraft(String(tokens ?? DEFAULT_TOKENS));
  }, [visibleTo, visibilityNotes, tokens, challengeId]);

  function parsedTokens(): number | null {
    const n = Number(tokensDraft);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.trunc(n);
  }

  async function onSave(): Promise<void> {
    const nextTokens = parsedTokens();
    if (nextTokens == null) {
      setError('Tokens must be a non-negative whole number');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await saveChallengeVisibility(challengeId, value, notes, nextTokens);
      setSavedAt(Date.now());
      onSaved?.({
        visibleTo: result.visibleTo,
        visibilityNotes: result.visibilityNotes || '',
        tokens: result.tokens ?? DEFAULT_TOKENS,
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error || err.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const savedAudience = visibleTo || DEFAULT_VISIBLE_TO;
  const savedNotes = visibilityNotes || '';
  const savedTokens = tokens ?? DEFAULT_TOKENS;
  const draftTokens = parsedTokens();
  const dirty =
    value !== savedAudience ||
    notes !== savedNotes ||
    draftTokens !== savedTokens;

  return (
    <div className="challenge-visibility-panel">
      <h3 className="challenge-staff-title">Visibility</h3>
      <p className="challenge-staff-lead">
        Control who can see and open this challenge in Play.
      </p>
      {locked ? (
        <p className="challenge-staff-lead challenge-visibility-locked">
          Visibility and tokens are synced from local on every deploy. Change them locally, then
          redeploy. Notes can still be edited here.
        </p>
      ) : null}
      <div className="challenge-visibility-options" role="radiogroup" aria-label="Challenge visibility">
        {OPTIONS.map((opt) => (
          <label key={opt.value} className="challenge-visibility-option">
            <input
              type="radio"
              name={`visible-to-${challengeId}`}
              value={opt.value}
              checked={value === opt.value}
              disabled={locked}
              onChange={() => setValue(opt.value)}
            />
            <span>
              <strong>{opt.label}</strong>
              <span className="challenge-visibility-help">{opt.help}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="challenge-visibility-notes">
        <label className="challenge-staff-title" htmlFor={`tokens-${challengeId}`}>
          Tokens
        </label>
        <p className="challenge-staff-lead">
          Reward granted when a learner solves this lab.
        </p>
        <input
          id={`tokens-${challengeId}`}
          className="challenge-tokens-input"
          type="number"
          min={0}
          step={1}
          value={tokensDraft}
          disabled={locked}
          onChange={(e) => setTokensDraft(e.target.value)}
        />
      </div>

      <div className="challenge-visibility-notes">
        <label className="challenge-staff-title" htmlFor={`visibility-notes-${challengeId}`}>
          Notes
        </label>
        <p className="challenge-staff-lead">
          Admin-only notes about why this visibility is set. Not shown to reviewers or learners.
        </p>
        <textarea
          id={`visibility-notes-${challengeId}`}
          className="challenge-review-textarea"
          rows={5}
          value={notes}
          placeholder="Why this lab is gated, rollout plan, blockers…"
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="challenge-staff-actions">
        <button
          type="button"
          className="admin-btn admin-btn--approve"
          disabled={saving || !dirty}
          onClick={() => void onSave()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedAt && !dirty && !error ? (
          <span className="challenge-staff-status">Saved</span>
        ) : null}
        {error ? <span className="challenge-staff-status challenge-staff-status--error">{error}</span> : null}
      </div>
    </div>
  );
}
