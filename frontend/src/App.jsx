import React, { useEffect, useState } from 'react';
import LoginPage from './components/LoginPage.jsx';
import ChallengeLibrary from './components/ChallengeLibrary.jsx';
import SessionController from './components/SessionController.jsx';
import ProblemStatement from './components/ProblemStatement.jsx';
import TerminalWorkspace from './components/TerminalWorkspace.jsx';
import MetricsDashboard, { useMetricsState } from './components/MetricsDashboard.jsx';
import AlertsPanel from './components/AlertsPanel.jsx';
import AuthoringWorkspace from './pages/AuthoringWorkspace.jsx';
import { getToken, logout, resolveInvite } from './services/authApi.js';
import { fetchChallenges, fetchChallenge } from './services/challengeApi.js';
import { startSession, endSession } from './services/sessionApi.js';

const CANDIDATE_PARAM = 'candidate';

function readCandidateToken() {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(CANDIDATE_PARAM);
  } catch (_e) {
    return null;
  }
}

function clearCandidateParam() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(CANDIDATE_PARAM);
    window.history.replaceState({}, '', url.toString());
  } catch (_e) { /* noop */ }
}

function useMetricsStream(wsUrl) {
  const { series, latest, recovered, handleMessage } = useMetricsState();

  useEffect(() => {
    if (!wsUrl) return undefined;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try { handleMessage(JSON.parse(ev.data)); } catch (_e) { /* ignore */ }
    };
    return () => { try { ws.close(); } catch (_e) { /* noop */ } };
  }, [wsUrl, handleMessage]);

  return { series, latest, recovered };
}

export default function App() {
  // 'resolving' | 'unauthenticated' | 'interviewer' | 'candidate'
  const [authMode, setAuthMode] = useState('resolving');
  const [candidateInvite, setCandidateInvite] = useState(null);
  const [candidateError, setCandidateError] = useState(null);
  const [challenges, setChallenges] = useState([]);
  const [challengesError, setChallengesError] = useState(null);

  const [playState, setPlayState] = useState('library'); // library|loading|active|ended
  const [activeSession, setActiveSession] = useState(null);
  const [activeChallenge, setActiveChallenge] = useState(null);
  const [endResult, setEndResult] = useState(null);
  const [ending, setEnding] = useState(false);
  const [startError, setStartError] = useState(null);
  const [activeTab, setActiveTab] = useState('problem'); // 'problem' | 'metrics'
  const [page, setPage] = useState('play'); // 'play' | 'authoring' (interviewer-only)

  const metricsWsUrl = playState === 'active' ? activeSession?.metricsWsUrl : null;
  const { series, latest, recovered } = useMetricsStream(metricsWsUrl);

  useEffect(() => {
    const candidateToken = readCandidateToken();
    if (candidateToken) {
      (async () => {
        try {
          const inv = await resolveInvite(candidateToken);
          setCandidateInvite({ ...inv, token: candidateToken });
          setAuthMode('candidate');
        } catch (e) {
          setCandidateError(e?.response?.data?.error || e.message);
          setAuthMode('unauthenticated');
        }
      })();
      return;
    }
    if (getToken()) {
      setAuthMode('interviewer');
    } else {
      setAuthMode('unauthenticated');
    }
  }, []);

  useEffect(() => {
    if (authMode === 'interviewer') {
      (async () => {
        try {
          const list = await fetchChallenges();
          setChallenges(list);
        } catch (e) {
          setChallengesError(e?.response?.data?.error || e.message);
        }
      })();
    } else if (authMode === 'candidate' && candidateInvite?.challengeId) {
      (async () => {
        try {
          const c = await fetchChallenge(candidateInvite.challengeId);
          setChallenges([c]);
        } catch (e) {
          setChallengesError(e?.response?.data?.error || e.message);
        }
      })();
    }
  }, [authMode, candidateInvite]);

  // Auto-start candidate sessions on the assigned challenge.
  useEffect(() => {
    if (
      authMode === 'candidate' &&
      candidateInvite?.challengeId &&
      challenges.length > 0 &&
      playState === 'library' &&
      !candidateInvite.used
    ) {
      const c = challenges.find((x) => x.id === candidateInvite.challengeId);
      if (c && c.finalized) {
        handleSelectChallenge(c);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authMode, candidateInvite, challenges]);

  const handleSelectChallenge = async (challenge) => {
    setStartError(null);
    setPlayState('loading');
    setActiveChallenge(challenge);
    try {
      const candidateToken = authMode === 'candidate' ? candidateInvite?.token : null;
      const res = await startSession(challenge.id, candidateToken);
      setActiveSession({
        id: res.sessionId,
        startTime: res.session?.startTime || Date.now(),
        recovered: false,
        terminalWsUrl: res.terminalWsUrl,
        metricsWsUrl: res.metricsWsUrl,
        portMap: res.session?.portMap || null,
        services: res.services || [],
        terminalService: res.terminalService || null,
      });
      setActiveChallenge(res.challenge || challenge);
      setActiveTab('problem');
      setPlayState('active');
      if (authMode === 'candidate') clearCandidateParam();
    } catch (e) {
      setStartError(e?.response?.data?.error || e.message);
      setPlayState('library');
    }
  };

  const handleEnd = async () => {
    if (!activeSession) return;
    setEnding(true);
    try {
      const res = await endSession(activeSession.id);
      setEndResult(res);
      setPlayState('ended');
    } catch (e) {
      setStartError(e?.response?.data?.error || e.message);
    } finally {
      setEnding(false);
    }
  };

  const handleBackToLibrary = () => {
    setPlayState('library');
    setActiveSession(null);
    setActiveChallenge(null);
    setEndResult(null);
  };

  if (authMode === 'resolving') {
    return (
      <div className="login">
        <div><span className="spinner" /> Loading…</div>
      </div>
    );
  }

  if (authMode === 'unauthenticated') {
    return (
      <>
        {candidateError && (
          <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 10 }}>
            <div className="alert">Candidate invite error: {candidateError}</div>
          </div>
        )}
        <LoginPage onLoggedIn={() => setAuthMode('interviewer')} />
      </>
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="logo-dot" />
          System Escape Room
          <span className="sub">v0.1</span>
        </div>

        {authMode === 'interviewer' && playState !== 'active' && (
          <div className="topnav">
            <button
              className={`topnav-pill ${page === 'play' ? 'active' : ''}`}
              onClick={() => setPage('play')}
            >Play</button>
            <button
              className={`topnav-pill ${page === 'authoring' ? 'active' : ''}`}
              onClick={() => setPage('authoring')}
            >Authoring</button>
          </div>
        )}

        <div className="right">
          {playState === 'active' && activeSession && (
            <SessionController
              session={activeSession}
              onEnd={handleEnd}
              ending={ending}
            />
          )}
          {authMode === 'interviewer' && (
            <>
              <span className="badge brand"><span className="dot" /> interviewer</span>
              <button
                className="ghost"
                onClick={() => { logout(); setAuthMode('unauthenticated'); }}
              >
                Sign out
              </button>
            </>
          )}
          {authMode === 'candidate' && (
            <span className="badge brand"><span className="dot" /> {candidateInvite?.name}</span>
          )}
        </div>
      </div>

      {page === 'authoring' && authMode === 'interviewer' && (
        <div className="main authoring-page">
          <AuthoringWorkspace
            onPromoted={async () => {
              try {
                const list = await fetchChallenges();
                setChallenges(list);
              } catch (_e) { /* noop */ }
            }}
          />
        </div>
      )}

      {page === 'play' && playState === 'library' && (
        <div className="main">
          {challengesError && <div className="alert" style={{ marginBottom: 14 }}>{challengesError}</div>}
          {startError && <div className="alert" style={{ marginBottom: 14 }}>Failed to start: {startError}</div>}
          <div className="page-header">
            <h2>Challenge Library</h2>
            <span className="sub">{challenges.length} {challenges.length === 1 ? 'challenge' : 'challenges'} available</span>
          </div>
          <ChallengeLibrary challenges={challenges} onSelect={handleSelectChallenge} />
        </div>
      )}

      {page === 'play' && playState === 'loading' && (
        <div className="main">
          <div className="loading-card">
            <span className="spinner" />
            <div>
              Spinning up sandbox for <strong>{activeChallenge?.title}</strong>…
              <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>
                This can take 30–60 seconds the first time while Docker images build.
              </div>
            </div>
          </div>
        </div>
      )}

      {page === 'play' && playState === 'active' && activeSession && (
        <div className="workspace workspace-2col">
          <div className="col">
            <div className="panel" style={{ flex: 1 }}>
              <div className="panel-header">
                <div className="panel-tabs">
                  <button
                    className={`panel-tab ${activeTab === 'problem' ? 'active' : ''}`}
                    onClick={() => setActiveTab('problem')}
                  >
                    <span className="icon">◆</span> Incident Brief
                  </button>
                  <button
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
                  {(activeSession.services || []).length} {(activeSession.services || []).length === 1 ? 'container' : 'containers'} · {activeSession.id.slice(0, 8)}
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
      )}

      {page === 'play' && playState === 'ended' && endResult && (
        <div className="main">
          <div className="score-card">
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
            <button style={{ marginTop: 20 }} onClick={handleBackToLibrary}>
              Back to library
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
