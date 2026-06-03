import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReviewSandboxWorkspace from '../components/ReviewSandboxWorkspace.jsx';
import {
  startReviewPreview,
  endReviewPreview,
} from '../services/reviewApi.js';
import { setReviewSignoff } from '../utils/reviewHelpers.js';

export default function ReviewSandboxPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await startReviewPreview(sessionId);
        if (cancelled) {
          await endReviewPreview(sessionId).catch(() => {});
          return;
        }
        setPreview({
          session: {
            id: res.sessionId,
            terminalWsUrl: res.terminalWsUrl,
            metricsWsUrl: res.metricsWsUrl,
            services: res.services || res.session?.services || [],
            terminalService: res.terminalService || res.session?.terminalService,
            portMap: res.portMap || res.session?.portMap,
          },
          challenge: res.challenge,
        });
        setReviewSignoff(sessionId, { touched: true });
      } catch (e) {
        if (!cancelled) {
          setErr(e?.response?.data?.error || e.message);
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

  const goBack = () => {
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
