import React from 'react';
import type { ReviewRecord } from '../types/domain';

interface ReviewActionBarProps {
  r: ReviewRecord;
  onPush: (id: string) => void | Promise<void>;
  onDismiss: (id: string) => void | Promise<void>;
  onOpenSandbox: (reviewSessionId: string) => void;
  onBack?: () => void;
  previewBusy?: boolean;
  busy: boolean;
  sandboxValidated: boolean;
  onSandboxValidatedChange: (checked: boolean) => void;
  sandboxTouched: boolean;
  showOpenSandbox?: boolean;
}

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
}: ReviewActionBarProps): JSX.Element | null {
  if (!r) return null;
  const canPush = !busy && !previewBusy && r.buildValidation?.passed && sandboxValidated;

  return (
    <div className="review-action-bar">
      <div className="review-action-bar-signoff">
        <label className="review-signoff review-signoff--compact">
          <input
            type="checkbox"
            checked={sandboxValidated}
            disabled={!sandboxTouched || busy || previewBusy}
            onChange={(e) => onSandboxValidatedChange(e.target.checked)}
          />
          <span>I validated this in the sandbox</span>
        </label>
      </div>
      <div className="review-action-bar-btns">
        {onBack && (
          <button type="button" className="ghost sm" onClick={onBack} disabled={busy || previewBusy}>
            Back
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
                : 'Ship to challenge library'
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
