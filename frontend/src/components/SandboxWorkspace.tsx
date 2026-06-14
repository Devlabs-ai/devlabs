import React, { useEffect, useState } from 'react';
import ProblemStatement from './ProblemStatement';
import TerminalWorkspace from './TerminalWorkspace';
import CodeEditor from './CodeEditor';
import BrowserTab from './BrowserTab';
import MetricsDashboard, { useMetricsState } from './MetricsDashboard';
import type { ChallengePublic, ChallengeFull, ActiveSession, MetricsSeriesPoint } from '../types/domain';

interface ExternalMetrics {
  series?: MetricsSeriesPoint[];
  latest?: MetricsSeriesPoint | null;
  recovered?: boolean;
}

interface UseMetricsStreamResult {
  series: MetricsSeriesPoint[];
  latest: MetricsSeriesPoint | null;
  recovered: boolean;
}

function useMetricsStream(
  wsUrl: string | null | undefined,
  external: ExternalMetrics | null | undefined,
): UseMetricsStreamResult {
  const internal = useMetricsState();
  const useExternal = !!(external && (external.series != null || external.latest != null));

  useEffect(() => {
    if (useExternal || !wsUrl) return undefined;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev: MessageEvent): void => {
      try { internal.handleMessage(JSON.parse(ev.data as string)); } catch (_e) { /* ignore */ }
    };
    return () => { try { ws.close(); } catch (_e) { /* noop */ } };
  }, [wsUrl, useExternal, internal.handleMessage]);

  if (useExternal) {
    return {
      series: external?.series || [],
      latest: external?.latest ?? null,
      recovered: external?.recovered ?? false,
    };
  }
  return {
    series: internal.series,
    latest: internal.latest,
    recovered: internal.recovered,
  };
}

export interface SandboxWorkspaceProps {
  challenge: ChallengePublic | ChallengeFull | null | undefined;
  session: ActiveSession | null;
  mode?: 'play' | 'review' | string;
  metrics?: ExternalMetrics | null;
  onClose?: () => void;
  closing?: boolean;
}

/**
 * Shared Play / Review sandbox layout: brief, metrics, terminal, editor, browser.
 */
export default function SandboxWorkspace({
  challenge,
  session,
  mode = 'play',
  metrics: externalMetrics,
  onClose,
  closing,
}: SandboxWorkspaceProps): JSX.Element | null {
  const [rightTab, setRightTab] = useState<string>('terminal');
  const { series, latest, recovered } = useMetricsStream(session?.metricsWsUrl, externalMetrics);

  if (!session) return null;

  const isReview = mode === 'review';

  return (
    <div className="workspace workspace-2col sandbox-workspace">
      <div className="col">
        <div className={`panel${isReview ? '' : ' sandbox-brief-panel--solo'}`} style={{ flex: 1 }}>
          <div className="panel-header">
            <div className="title">
              <span className="icon">◆</span> Inc Brief
            </div>
            <span className="meta">
              {isReview && <span className="pill review-mode-pill">Review</span>}
              {challenge?.difficulty && (
                <span className={isReview ? 'review-mode-difficulty' : undefined}>
                  {challenge.difficulty}
                </span>
              )}
            </span>
          </div>
          <div className="panel-body">
            <ProblemStatement challenge={challenge} />
          </div>
        </div>
        {isReview && (
          <div className="panel sandbox-metrics-panel">
            <div className="panel-header">
              <div className="title">Metrics</div>
            </div>
            <div className="panel-body">
              <MetricsDashboard
                series={series}
                latest={latest}
                recovered={recovered}
                portMap={session.portMap}
              />
            </div>
          </div>
        )}
      </div>

      <div className="col col-main">
        <div className="panel" style={{ flex: 1 }}>
          <div className="panel-header">
            <div className="panel-tabs">
              <button
                type="button"
                className={`panel-tab ${rightTab === 'terminal' ? 'active' : ''}`}
                onClick={() => setRightTab('terminal')}
              >
                <span className="term-dots"><span /><span /><span /></span>
                Terminal
              </button>
              <button
                type="button"
                className={`panel-tab ${rightTab === 'editor' ? 'active' : ''}`}
                onClick={() => setRightTab('editor')}
              >
                <span className="icon">&#9632;</span> Editor
              </button>
              <button
                type="button"
                className={`panel-tab ${rightTab === 'browser' ? 'active' : ''}`}
                onClick={() => setRightTab('browser')}
              >
                <span className="icon">⬡</span> Browser
              </button>
            </div>
            <span className="meta">
              {(session.services || []).length}{' '}
              {(session.services || []).length === 1 ? 'container' : 'containers'}
              {' · '}
              <span title={session.id} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {session.id.slice(0, 8)}
              </span>
              {onClose && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="ghost sm review-sandbox-back"
                    onClick={onClose}
                    disabled={closing}
                  >
                    {closing ? 'Closing…' : '← Back to queue'}
                  </button>
                </>
              )}
            </span>
          </div>
          <div className="panel-body flush">
            <div style={{ display: rightTab === 'terminal' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <TerminalWorkspace
                services={session.services}
                baseWsUrl={session.terminalWsUrl ?? ''}
                defaultService={session.terminalService}
              />
            </div>
            <div style={{ display: rightTab === 'editor' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <CodeEditor
                sessionId={session.id}
                services={session.services}
                defaultContainer={session.terminalService ?? undefined}
              />
            </div>
            <div style={{ display: rightTab === 'browser' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <BrowserTab sessionId={session.id} portMap={session.portMap} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
