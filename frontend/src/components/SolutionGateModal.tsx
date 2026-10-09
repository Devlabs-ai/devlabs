import React, { useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import {
  fetchSolutionStatus,
  recordSolutionView,
  type SolutionStatus,
} from '../services/challengeApi';

const ACK_KEY_PREFIX = 'devsetu.solutionGate.ack.';

export function hasAcknowledgedSolution(challengeId: string): boolean {
  if (!challengeId) return false;
  try {
    return sessionStorage.getItem(`${ACK_KEY_PREFIX}${challengeId}`) === '1';
  } catch {
    return false;
  }
}

function rememberAcknowledged(challengeId: string): void {
  if (!challengeId) return;
  try {
    sessionStorage.setItem(`${ACK_KEY_PREFIX}${challengeId}`, '1');
  } catch {
    /* quota */
  }
}

interface SolutionGateModalProps {
  open: boolean;
  challengeId: string;
  onCancel: () => void;
  onConfirm: () => void;
}

function PenaltyNotice({ status }: { status: SolutionStatus | null }): JSX.Element | null {
  if (!status || status.practice) return null;
  if (status.solved && !status.penalized) {
    return (
      <p className="solution-gate-penalty is-free">
        You already solved this lab, so opening the solution won&apos;t cost any tokens.
      </p>
    );
  }
  if (status.viewedAt != null) {
    return (
      <p className="solution-gate-penalty">
        You opened this solution before solving the lab, so it now awards{' '}
        <strong>{status.tokensAfterPenalty} tokens</strong> instead of {status.tokens}.
      </p>
    );
  }
  return (
    <p className="solution-gate-penalty">
      Opening the solution before a correct submission costs <strong>{status.penaltyPct}%</strong> of
      this lab&apos;s tokens: you&apos;ll earn <strong>{status.tokensAfterPenalty}</strong> instead
      of {status.tokens} when you solve it.
    </p>
  );
}

export default function SolutionGateModal({
  open,
  challengeId,
  onCancel,
  onConfirm,
}: SolutionGateModalProps): JSX.Element | null {
  const [status, setStatus] = useState<SolutionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !challengeId) return undefined;
    let cancelled = false;
    setStatus(null);
    setError(null);
    fetchSolutionStatus(challengeId)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        /* the generic warning still shows */
      });
    return () => {
      cancelled = true;
    };
  }, [open, challengeId]);

  const willPenalize = Boolean(status && status.penalized && status.viewedAt == null);

  return (
    <ConfirmDialog
      open={open}
      title="Go till the last mile"
      confirmLabel={willPenalize ? `Show solution (−${status!.penaltyPct}% tokens)` : 'Show solution'}
      cancelLabel="Keep trying"
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        setBusy(true);
        setError(null);
        recordSolutionView(challengeId)
          .then(() => {
            rememberAcknowledged(challengeId);
            onConfirm();
          })
          .catch(() => setError('Could not open the solution right now. Please try again.'))
          .finally(() => setBusy(false));
      }}
    >
      <p>
        You learn the most in the moments you are stuck. Re-read the spec, check{' '}
        <code>kubectl describe</code> / events / logs, and try one more idea before peeking.
      </p>
      <PenaltyNotice status={status} />
      <p>Open the solution only if you really feel there is no other way forward.</p>
      {error ? <p className="solution-gate-error" role="alert">{error}</p> : null}
    </ConfirmDialog>
  );
}
