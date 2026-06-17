import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import PricingPage from './pages/PricingPage';
import AboutPage from './pages/AboutPage';
import PlayPage from './pages/PlayPage';
import AuthoringPage from './pages/AuthoringPage';
import ReviewRoutePage from './pages/ReviewRoutePage';
import ReviewSandboxPage from './pages/ReviewSandboxPage';
import ProfilePage from './pages/ProfilePage';
import DbExplorerPage from './pages/DbExplorerPage';
import AppLayout from './layouts/AppLayout';
import { AppStateProvider } from './context/AppStateContext';
import { getToken, getCurrentUser, logout, resolveInvite } from './services/authApi';
import { fetchChallenges, fetchChallenge } from './services/challengeApi';
import { startSession, endSession, restoreSession } from './services/sessionApi';
import type {
  AuthMode,
  PlayState,
  WorkspaceTab,
  ActiveSession,
  ChallengePublic,
  ChallengeFull,
  InviteRecord,
  UserRecord,
  EndSessionResult,
  AppState,
} from './types/domain';

const CANDIDATE_PARAM = 'candidate';

function readCandidateToken(): string | null {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(CANDIDATE_PARAM);
  } catch (_e) {
    return null;
  }
}

function clearCandidateParam(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(CANDIDATE_PARAM);
    window.history.replaceState({}, '', url.pathname + url.search);
  } catch (_e) { /* noop */ }
}

export default function App(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  const [authMode, setAuthMode] = useState<AuthMode>('resolving');
  const [currentUser, setCurrentUser] = useState<UserRecord | null>(null);
  const [candidateInvite, setCandidateInvite] = useState<InviteRecord | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [challenges, setChallenges] = useState<ChallengePublic[]>([]);
  const [challengesError, setChallengesError] = useState<string | null>(null);

  const [playState, setPlayState] = useState<PlayState>('library');
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [activeChallenge, setActiveChallenge] = useState<ChallengePublic | ChallengeFull | null>(null);
  const [endResult, setEndResult] = useState<EndSessionResult | null>(null);
  const [ending, setEnding] = useState<boolean>(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('problem');

  useEffect(() => {
    const candidateToken = readCandidateToken();
    if (candidateToken) {
      (async () => {
        try {
          const inv = await resolveInvite(candidateToken);
          setCandidateInvite(inv);
          setAuthMode('candidate');
        } catch (e) {
          const err = e as { response?: { data?: { error?: string } }; message?: string };
          setCandidateError(err?.response?.data?.error || err.message || 'Unknown error');
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
          const err = e as { response?: { data?: { error?: string } }; message?: string };
          setChallengesError(err?.response?.data?.error || err.message || 'Unknown error');
        }
      })();
    } else if (authMode === 'candidate' && candidateInvite?.challengeId) {
      (async () => {
        try {
          const c = await fetchChallenge(candidateInvite.challengeId);
          setChallenges([c]);
        } catch (e) {
          const err = e as { response?: { data?: { error?: string } }; message?: string };
          setChallengesError(err?.response?.data?.error || err.message || 'Unknown error');
        }
      })();
    }
  }, [authMode, candidateInvite]);

  const handleSelectChallenge = async (challenge: ChallengePublic | ChallengeFull): Promise<void> => {
    setStartError(null);
    setPlayState('loading');
    setActiveChallenge(challenge);
    navigate('/play');
    try {
      const candidateToken = authMode === 'candidate' ? (candidateInvite?.token ?? null) : null;
      const res = await startSession(challenge.id, candidateToken);
      const rawSession = res.session as {
        startTime?: number;
        portMap?: Record<string, string | number> | null;
      } | null | undefined;
      setActiveSession({
        id: res.sessionId,
        startTime: rawSession?.startTime || Date.now(),
        recovered: false,
        terminalWsUrl: (res.terminalWsUrl as string | null) ?? null,
        metricsWsUrl: (res.metricsWsUrl as string | null) ?? null,
        portMap: rawSession?.portMap ?? null,
        services: res.services || [],
        terminalService: res.terminalService ?? null,
      });
      setActiveChallenge((res.challenge as ChallengePublic | null) || challenge);
      setActiveTab('problem');
      setPlayState('active');
      navigate(`/play/${res.sessionId}`, { replace: true });
      if (authMode === 'candidate') clearCandidateParam();
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setStartError(err?.response?.data?.error || err.message || 'Unknown error');
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
        if (!res || (res as { status?: string }).status === 'ended') {
          setPlayState('library');
          navigate('/play', { replace: true });
          return;
        }
        setActiveSession({
          id: res.sessionId,
          startTime: res.startTime || Date.now(),
          recovered: (res.session as { recovered?: boolean } | null | undefined)?.recovered ?? false,
          terminalWsUrl: res.terminalWsUrl ?? null,
          metricsWsUrl: res.metricsWsUrl ?? null,
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

  const handleEnd = async (): Promise<void> => {
    if (!activeSession) return;
    setEnding(true);
    try {
      const res = await endSession(activeSession.id);
      setEndResult(res as EndSessionResult);
      setPlayState('ended');
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setStartError(err?.response?.data?.error || err.message || 'Unknown error');
    } finally {
      setEnding(false);
    }
  };

  const handleBackToLibrary = (): void => {
    setPlayState('library');
    setActiveSession(null);
    setActiveChallenge(null);
    setEndResult(null);
    navigate('/play');
  };

  const handleLogout = (): void => {
    logout();
    setCurrentUser(null);
    setAuthMode('unauthenticated');
    navigate('/');
  };

  const handleLoggedIn = (user?: UserRecord | null): void => {
    setCurrentUser(user || getCurrentUser());
    setAuthMode('interviewer');
    navigate('/play', { replace: true });
  };

  useEffect(() => {
    if (authMode !== 'unauthenticated' && authMode !== 'resolving' && location.pathname === '/') {
      navigate('/play', { replace: true });
    }
  }, [authMode, location.pathname, navigate]);

  const refreshChallenges = async (): Promise<void> => {
    try {
      const list = await fetchChallenges();
      setChallenges(list);
    } catch (_e) { /* noop */ }
  };

  const appState = useMemo<AppState>(() => ({
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
        <Route
          path="/about"
          element={
            <AboutPage
              candidateError={candidateError}
              onLoggedIn={handleLoggedIn}
            />
          }
        />
        <Route
          path="/pricing"
          element={
            <PricingPage
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
              <Route path="profile" element={<ProfilePage />} />
              {import.meta.env.DEV && (
                <Route path="dev/db" element={<DbExplorerPage />} />
              )}
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
