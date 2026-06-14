import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReviewSandboxWorkspace from '../components/ReviewSandboxWorkspace';
import {
  startReviewPreview,
  endReviewPreview,
} from '../services/reviewApi';
import { setReviewSignoff } from '../utils/reviewHelpers';
import type { ChallengePublic, ChallengeFull, ActiveSession } from '../types/domain';

interface ReviewPreview {
  session: ActiveSession;
  challenge: ChallengePublic | ChallengeFull | null;
}

export default function ReviewSandboxPage(): JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<ReviewPreview | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    (async (): Promise<void> => {
      setLoading(true);
      setErr(null);
      try {
        const res = await startReviewPreview(sessionId) as {
          sessionId: string;
          terminalWsUrl: string;
          metricsWsUrl: string;
          services?: string[];
          session?: { services?: string[]; terminalService?: string; portMap?: Record<string, string | number> };
          terminalService?: string;
          portMap?: Record<string, string | number>;
          challenge?: ChallengePublic | ChallengeFull;
        };
        if (cancelled) {
          await endReviewPreview(sessionId).catch(() => {});
          return;
        }
        setPreview({
          session: {
            id: res.sessionId,
            startTime: Date.now(),
            recovered: false,
            terminalWsUrl: res.terminalWsUrl,
            metricsWsUrl: res.metricsWsUrl,
            services: res.services || res.session?.services || [],
            terminalService: res.terminalService || res.session?.terminalService || null,
            portMap: res.portMap || res.session?.portMap || null,
          },
          challenge: res.challenge ?? null,
        });
        setReviewSignoff(sessionId, { touched: true });
      } catch (e: unknown) {
        if (!cancelled) {
          const err = e as { response?: { data?: { error?: string } }; message?: string };
          setErr(err?.response?.data?.error || err.message || 'Unknown error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      endReviewPreview(sessionId).catch(() => {});
    };
  }, [sessionId]);

  const goBack = (): void => {
    navigate('/review', { state: { sessionId, sandboxTouched: true } });
  };

  return (
    <div className="app-page review-sandbox-page app-page-fill">
      {err && <div className="authoring-banner alert authoring-banner--compact">{err}</div>}

      {loading ? (
        <div className="review-sandbox-loading">
          <span className="spinner" />
          <p>Starting sandbox…</p>
        </div>
      ) : preview ? (
        <div className="review-preview-stage review-preview-stage--full">
          <ReviewSandboxWorkspace
            challenge={preview.challenge}
            session={preview.session}
            onClose={goBack}
          />
        </div>
      ) : null}
    </div>
  );
}
