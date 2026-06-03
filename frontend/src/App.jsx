import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage.jsx';
import PlayPage from './pages/PlayPage.jsx';
import AuthoringPage from './pages/AuthoringPage.jsx';
import ReviewRoutePage from './pages/ReviewRoutePage.jsx';
import ReviewSandboxPage from './pages/ReviewSandboxPage.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import { AppStateProvider } from './context/AppStateContext.jsx';
import { getToken, getCurrentUser, logout, resolveInvite } from './services/authApi.js';
import { fetchChallenges, fetchChallenge } from './services/challengeApi.js';
import { startSession, endSession, restoreSession } from './services/sessionApi.js';

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
    window.history.replaceState({}, '', url.pathname + url.search);
  } catch (_e) { /* noop */ }
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [authMode, setAuthMode] = useState('resolving');
  const [currentUser, setCurrentUser] = useState(null);
  const [candidateInvite, setCandidateInvite] = useState(null);
  const [candidateError, setCandidateError] = useState(null);
  const [challenges, setChallenges] = useState([]);
  const [challengesError, setChallengesError] = useState(null);

  const [playState, setPlayState] = useState('library');
  const [activeSession, setActiveSession] = useState(null);
  const [activeChallenge, setActiveChallenge] = useState(null);
  const [endResult, setEndResult] = useState(null);
  const [ending, setEnding] = useState(false);
  const [startError, setStartError] = useState(null);
  const [activeTab, setActiveTab] = useState('problem');

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
      setCurrentUser(getCurrentUser());
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

  const handleSelectChallenge = async (challenge) => {
    setStartError(null);
    setPlayState('loading');
    setActiveChallenge(challenge);
    navigate('/play');
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
      navigate(`/play/${res.sessionId}`, { replace: true });
      if (authMode === 'candidate') clearCandidateParam();
    } catch (e) {
      setStartError(e?.response?.data?.error || e.message);
      setPlayState('library');
    }
  };

  // Restore an in-progress session when the user navigates directly to /play/:sessionId
  useEffect(() => {
    if (playState !== 'library' || authMode === 'resolving') return;
    const match = location.pathname.match(/^\/play\/([a-zA-Z0-9-]+)$/);
    if (!match) return;
    const sessionId = match[1];
    setPlayState('loading');
    restoreSession(sessionId)
      .then((res) => {
        if (!res || res.status === 'ended') {
          setPlayState('library');
          navigate('/play', { replace: true });
          return;
        }
        setActiveSession({
          id: res.sessionId,
          startTime: res.startTime || Date.now(),
          recovered: res.session?.recovered ?? false,
          terminalWsUrl: res.terminalWsUrl,
          metricsWsUrl: res.metricsWsUrl,
          portMap: res.portMap || null,
          services: res.services || [],
          terminalService: res.terminalService || null,
        });
        setActiveChallenge(res.challenge || null);
        setActiveTab('problem');
        setPlayState('active');
      })
      .catch(() => {
        setPlayState('library');
        navigate('/play', { replace: true });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authMode]);

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
    navigate('/play');
  };

  const handleLogout = () => {
    logout();
    setCurrentUser(null);
    setAuthMode('unauthenticated');
    navigate('/');
  };

  const handleLoggedIn = (user) => {
    setCurrentUser(user || getCurrentUser());
    setAuthMode('interviewer');
    navigate('/play', { replace: true });
  };

  useEffect(() => {
    if (authMode !== 'unauthenticated' && authMode !== 'resolving' && location.pathname === '/') {
      navigate('/play', { replace: true });
    }
  }, [authMode, location.pathname, navigate]);

  const refreshChallenges = async () => {
    try {
      const list = await fetchChallenges();
      setChallenges(list);
    } catch (_e) { /* noop */ }
  };

  const appState = useMemo(() => ({
    authMode,
    currentUser,
    candidateInvite,
    playState,
    challenges,
    challengesError,
    startError,
    activeSession,
    activeChallenge,
    endResult,
    activeTab,
    setActiveTab,
    ending,
    onSelectChallenge: handleSelectChallenge,
    onBackToLibrary: handleBackToLibrary,
    onEnd: handleEnd,
    onLogout: handleLogout,
    onPromoted: refreshChallenges,
  }), [
    authMode,
    currentUser,
    candidateInvite,
    playState,
    challenges,
    challengesError,
    startError,
    activeSession,
    activeChallenge,
    endResult,
    activeTab,
    ending,
  ]);

  if (authMode === 'resolving') {
    return (
      <div className="login">
        <div><span className="spinner" /> Loading…</div>
      </div>
    );
  }

  if (authMode === 'unauthenticated') {
    return (
      <Routes>
        <Route
          path="/"
          element={
            <LandingPage
              candidateError={candidateError}
              onLoggedIn={handleLoggedIn}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  const isInterviewer = authMode === 'interviewer';

  return (
    <AppStateProvider value={appState}>
      <Routes>
        <Route path="/" element={<Navigate to="/play" replace />} />
        <Route element={<AppLayout />}>
          <Route path="play" element={<PlayPage />} />
          <Route path="play/:sessionId" element={<PlayPage />} />
          {isInterviewer ? (
            <>
              <Route path="authoring" element={<AuthoringPage />} />
              <Route path="authoring/:draftId" element={<AuthoringPage />} />
              <Route path="authoring/:draftId/:tab" element={<AuthoringPage />} />
              <Route path="review/:sessionId/sandbox" element={<ReviewSandboxPage />} />
              <Route path="review" element={<ReviewRoutePage />} />
            </>
          ) : (
            <>
              <Route path="authoring" element={<Navigate to="/play" replace />} />
              <Route path="authoring/*" element={<Navigate to="/play" replace />} />
            </>
          )}
        </Route>
        <Route path="*" element={<Navigate to="/play" replace />} />
      </Routes>
    </AppStateProvider>
  );
}
