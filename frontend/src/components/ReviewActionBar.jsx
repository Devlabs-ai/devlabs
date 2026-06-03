import React from 'react';
import { bucketLabel, resolvePushBucket } from '../utils/reviewHelpers.js';

export default function ReviewActionBar({
  r,
  onPush,
  onDismiss,
  onOpenSandbox,
  onBack,
  previewBusy,
  busy,
  sandboxValidated,
  onSandboxValidatedChange,
  sandboxTouched,
  showOpenSandbox = true,
}) {
  if (!r) return null;
  const bucket = resolvePushBucket(r);
  const canPush = !busy && !previewBusy && r.buildValidation?.passed && sandboxValidated;

  return (
    <div className="review-action-bar">
      <label className="review-signoff review-signoff--inline">
        <input
          type="checkbox"
          checked={sandboxValidated}
          onChange={(e) => onSandboxValidatedChange(e.target.checked)}
          disabled={busy || previewBusy || !sandboxTouched}
        />
        <span>Sandbox sign-off</span>
      </label>
      <div className="review-action-bar-buttons">
        {onBack && (
          <button type="button" className="ghost sm" onClick={onBack} disabled={busy || previewBusy}>
            ← Back to queue
          </button>
        )}
        {showOpenSandbox && (
          <button
            type="button"
            className="primary sm"
            onClick={() => onOpenSandbox(r.sessionId)}
            disabled={busy || previewBusy || !r.buildDir}
          >
            {previewBusy ? 'Starting…' : 'Open sandbox'}
          </button>
        )}
        <button
          type="button"
          className="sm"
          onClick={() => onPush(r.sessionId)}
          disabled={!canPush}
          title={
            !sandboxTouched
              ? 'Open sandbox and confirm sign-off first'
              : !sandboxValidated
                ? 'Confirm sandbox sign-off'
                : `Ship to ${bucketLabel(bucket) || 'library'}`
          }
        >
          {busy ? 'Shipping…' : 'Ship to library'}
        </button>
        <button
          type="button"
          className="ghost sm danger"
          onClick={() => onDismiss(r.sessionId)}
          disabled={busy || previewBusy}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
