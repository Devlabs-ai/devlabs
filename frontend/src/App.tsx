import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import PlayPage from './pages/PlayPage';
import AuthoringPage from './pages/AuthoringPage';
import ReviewRoutePage from './pages/ReviewRoutePage';
import ReviewSandboxPage from './pages/ReviewSandboxPage';
import ProfilePage from './pages/ProfilePage';
import DbExplorerPage from './pages/DbExplorerPage';
import AppLayout from './layouts/AppLayout';
import { AppStateProvider } from './context/AppStateContext';
import { getToken, getCurrentUser, logout } from './services/authApi';
import { fetchChallenges, fetchChallenge } from './services/challengeApi';
import { startSession, endSession, restoreSession } from './services/sessionApi';
import { startSparkSession } from './services/workspaceApi';
import { buildDailyProductSalesProject } from './fixtures/dailyProductSalesL1';
import { isSparkPlatformChallenge } from './components/SparkPlatformWorkspace';
import { catalogPathForChallenge, isPlayDomainId, looksLikePlaySessionId } from './constants/playCatalog';
import type {
  AuthMode,
  PlayState,
  WorkspaceTab,
  ActiveSession,
  ChallengePublic,
  ChallengeFull,
  UserRecord,
  EndSessionResult,
  AppState,
} from './types/domain';

export default function App(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const openingSessionRef = useRef<string | null>(null);

  const [authMode, setAuthMode] = useState<AuthMode>('resolving');
  const [currentUser, setCurrentUser] = useState<UserRecord | null>(null);
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
          setChallenges([]);
          setChallengesError(err?.response?.data?.error || err.message || 'Unknown error');
        }
      })();
    }
  }, [authMode]);

  const handleSelectChallenge = async (challenge: ChallengePublic | ChallengeFull): Promise<void> => {
    setStartError(null);
    setPlayState('loading');
    setActiveChallenge(challenge);

    // Spark-platform: create DB session + seed workspace in MinIO.
    if (isSparkPlatformChallenge(challenge)) {
      try {
        const full =
          (challenge as ChallengeFull).sparkPlatform
            ? (challenge as ChallengeFull)
            : await fetchChallenge(challenge.id);
        const platform = full.sparkPlatform;
        if (!platform) throw new Error('Missing sparkPlatform spec');
        const starterFiles = buildDailyProductSalesProject(platform);
        const res = await startSparkSession(
          full.id,
          starterFiles,
          platform.starterFileName || 'src/main.py',
        );
        setActiveSession({
          id: res.sessionId,
          startTime: Date.now(),
          recovered: false,
          terminalWsUrl: null,
          metricsWsUrl: null,
          portMap: null,
          services: [],
          terminalService: null,
          runtime: 'spark-platform',
        });
        setActiveChallenge(full);
        setActiveTab('editor');
        openingSessionRef.current = res.sessionId;
        setPlayState('active');
        navigate(`/play/${res.sessionId}`);
      } catch (e) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        setActiveChallenge(null);
        setActiveSession(null);
        setPlayState('library');
        navigate(catalogPathForChallenge(challenge.id), { replace: true });
        setStartError(
          err?.response?.data?.error
            || err.message
            || 'Failed to start spark session (MinIO unreachable)',
        );
      }
      return;
    }

    try {
      const res = await startSession(challenge.id);
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
        runtime: 'compose',
      });
      setActiveChallenge((res.challenge as ChallengePublic | null) || challenge);
      setActiveTab('problem');
      openingSessionRef.current = res.sessionId;
      setPlayState('active');
      navigate(`/play/${res.sessionId}`);
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setStartError(err?.response?.data?.error || err.message || 'Unknown error');
      setPlayState('library');
      navigate(catalogPathForChallenge(challenge.id), { replace: true });
    }
  };

  // Keep play UI in sync with the URL (browser Back/Forward, deep links).
  useEffect(() => {
    if (authMode === 'resolving' || authMode === 'unauthenticated') return;

    const path = location.pathname.replace(/\/$/, '') || '/';
    const segments = path.split('/').filter(Boolean); // ['play', ...]
    const underPlay = segments[0] === 'play';
    if (!underPlay) return;

    const a = segments[1] || null;
    const b = segments[2] || null;

    // Catalog: /play | /play/:domain | /play/:domain/:panel
    if (!a || isPlayDomainId(a)) {
      if (playState === 'loading') return;
      if (openingSessionRef.current) return;
      if (playState === 'active' || playState === 'ended') {
        setPlayState('library');
        setActiveSession(null);
        setActiveChallenge(null);
        setEndResult(null);
      }
      return;
    }

    // Session: /play/:sessionId (UUID / opaque id — not a catalog domain slug)
    if (b) return;
    const sessionId = a;

    if (!looksLikePlaySessionId(sessionId)) {
      navigate('/play', { replace: true });
      return;
    }

    if (openingSessionRef.current === sessionId) {
      openingSessionRef.current = null;
    }

    if (playState === 'active' && activeSession?.id === sessionId) return;
    if (playState === 'loading') return;

    setPlayState('loading');

    void (async () => {
      try {
        const res = await restoreSession(sessionId);
        if (!res || res.status === 'ended') {
          await restoreSparkWorkspace(sessionId, null);
          return;
        }

        const runtime =
          (res.session as { runtime?: string } | null | undefined)?.runtime ||
          (res as { runtime?: string }).runtime ||
          null;

        if (runtime === 'spark-platform' || sessionId.startsWith('spark-')) {
          await restoreSparkWorkspace(sessionId, res);
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
          runtime: 'compose',
        });
        setActiveChallenge(res.challenge || null);
        setActiveTab('problem');
        setPlayState('active');
      } catch {
        try {
          await restoreSparkWorkspace(sessionId, null);
        } catch {
          setPlayState('library');
          setActiveSession(null);
          setActiveChallenge(null);
          navigate('/play', { replace: true });
        }
      }
    })();

    async function restoreSparkWorkspace(
      sid: string,
      sessionRes: Awaited<ReturnType<typeof restoreSession>>,
    ): Promise<void> {
      const challengeId =
        (sessionRes?.session as { challengeId?: string } | null | undefined)?.challengeId ||
        sessionRes?.challenge?.id ||
        null;

      let full: ChallengeFull | null = null;
      if (challengeId) {
        full = await fetchChallenge(challengeId);
      } else {
        // Workspace exists without a recoverable challenge id — probe MinIO then default lab.
        const { fetchWorkspace } = await import('./services/workspaceApi');
        await fetchWorkspace(sid);
        full = await fetchChallenge('daily-product-sales-pipeline-l1');
      }

      if (!full?.sparkPlatform && full) {
        // Ensure spark fields exist even if list payload was thin.
        full = await fetchChallenge(full.id);
      }

      setActiveSession({
        id: sid,
        startTime: sessionRes?.startTime || Date.now(),
        recovered: true,
        terminalWsUrl: null,
        metricsWsUrl: null,
        portMap: null,
        services: [],
        terminalService: null,
        runtime: 'spark-platform',
      });
      setActiveChallenge(full);
      setActiveTab('editor');
      setPlayState('active');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, authMode, navigationType]);

  const handleEnd = async (): Promise<void> => {
    if (!activeSession) return;
    setEnding(true);
    try {
      if (activeSession.runtime === 'spark-platform' || activeSession.id.startsWith('spark-')) {
        setEndResult({
          sessionId: activeSession.id,
          elapsed: Date.now() - activeSession.startTime,
        });
        setPlayState('ended');
        return;
      }
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
    const dest = catalogPathForChallenge(activeChallenge?.id);
    setPlayState('library');
    setActiveSession(null);
    setActiveChallenge(null);
    setEndResult(null);
    navigate(dest);
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
            <LandingPage onLoggedIn={handleLoggedIn} />
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
          <Route path="play/:domainId" element={<PlayPage />} />
          <Route path="play/:domainId/:panelId" element={<PlayPage />} />
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
