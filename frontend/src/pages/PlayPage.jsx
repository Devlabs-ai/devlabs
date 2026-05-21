import React from 'react';
import { useAppState } from '../context/AppStateContext.jsx';
import AppPageHeader from '../components/AppPageHeader.jsx';
import ChallengeLibrary from '../components/ChallengeLibrary.jsx';
import ProblemStatement from '../components/ProblemStatement.jsx';
import TerminalWorkspace from '../components/TerminalWorkspace.jsx';
import MetricsDashboard from '../components/MetricsDashboard.jsx';
import AlertsPanel from '../components/AlertsPanel.jsx';

export default function PlayPage() {
  const {
    playState,
    challenges,
    challengesError,
    startError,
    activeSession,
    activeChallenge,
    endResult,
    activeTab,
    setActiveTab,
    series,
    latest,
    recovered,
    onSelectChallenge,
    onBackToLibrary,
  } = useAppState();

  if (playState === 'library') {
    return (
      <div className="app-page">
        {challengesError && <div className="alert app-page-alert">{challengesError}</div>}
        {startError && <div className="alert app-page-alert">Failed to start: {startError}</div>}
        <AppPageHeader
          eyebrow="Play"
          title="Challenge Library"
          meta={`${challenges.length} ${challenges.length === 1 ? 'challenge' : 'challenges'} available`}
          lead="Pick a curated lab and spin up a live Docker sandbox for your next interview."
        />
        <ChallengeLibrary challenges={challenges} onSelect={onSelectChallenge} />
      </div>
    );
  }

  if (playState === 'loading') {
    return (
      <div className="app-page app-page-centered">
        <div className="loading-card app-surface-card">
          <span className="spinner" />
          <div>
            Spinning up sandbox for <strong>{activeChallenge?.title}</strong>…
            <div style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 6 }}>
              This can take 30–60 seconds the first time while Docker images build.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (playState === 'active' && activeSession) {
    return (
      <div className="workspace workspace-2col">
        <div className="col">
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-header">
              <div className="panel-tabs">
                <button
                  type="button"
                  className={`panel-tab ${activeTab === 'problem' ? 'active' : ''}`}
                  onClick={() => setActiveTab('problem')}
                >
                  <span className="icon">◆</span> Incident Brief
                </button>
                <button
                  type="button"
                  className={`panel-tab ${activeTab === 'metrics' ? 'active' : ''}`}
                  onClick={() => setActiveTab('metrics')}
                >
                  <span className="icon">▲</span> Live Metrics
                  {latest && (
                    <span className={`tab-pill ${latest.latency < 50 ? 'ok' : latest.latency < 200 ? 'warn' : 'bad'}`}>
                      {Math.round(latest.latency)}ms
                    </span>
                  )}
                  {recovered && <span className="tab-pill ok">✓</span>}
                </button>
              </div>
              {activeTab === 'problem' && activeChallenge?.difficulty && (
                <span className="meta">{activeChallenge.difficulty}</span>
              )}
              {activeTab === 'metrics' && (
                <span className="meta">1 Hz</span>
              )}
            </div>
            <div className="panel-body tab-body">
              <div className="tab-pane" style={{ display: activeTab === 'problem' ? 'block' : 'none' }}>
                <ProblemStatement challenge={activeChallenge} />
              </div>
              <div
                className="tab-pane tab-pane-flex"
                style={{ display: activeTab === 'metrics' ? 'flex' : 'none' }}
              >
                <AlertsPanel latest={latest} />
                <MetricsDashboard
                  series={series}
                  latest={latest}
                  recovered={recovered}
                  portMap={activeSession.portMap}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="col col-main">
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-header">
              <div className="title">
                <span className="term-dots"><span /><span /><span /></span>
                Terminal — {activeChallenge?.id || 'sandbox'}
              </div>
              <span className="meta">
                {(activeSession.services || []).length}{' '}
                {(activeSession.services || []).length === 1 ? 'container' : 'containers'} ·{' '}
                {activeSession.id.slice(0, 8)}
              </span>
            </div>
            <div className="panel-body flush">
              <TerminalWorkspace
                services={activeSession.services}
                baseWsUrl={activeSession.terminalWsUrl}
                defaultService={activeSession.terminalService}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (playState === 'ended' && endResult) {
    return (
      <div className="app-page app-page-centered">
        <div className="score-card app-surface-card">
          <h2>Session ended</h2>
          <div className="score-display">{endResult.score}</div>
          <div className="summary-row">
            <span>Elapsed: {Math.floor(endResult.elapsed / 1000)}s</span>
            <span style={{ color: endResult.evaluation?.passed ? 'var(--brand-bright)' : 'var(--danger)' }}>
              {endResult.evaluation?.passed ? '✓ Validation passed' : '✗ Validation failed'}
            </span>
          </div>
          {endResult.evaluation?.feedback && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 12px' }}>
              {endResult.evaluation.feedback}
            </p>
          )}
          {endResult.breakdown && (
            <details>
              <summary>Score breakdown</summary>
              <pre>{JSON.stringify(endResult.breakdown, null, 2)}</pre>
            </details>
          )}
          <button type="button" style={{ marginTop: 20 }} onClick={onBackToLibrary}>
            Back to library
          </button>
        </div>
      </div>
    );
  }

  return null;
}
