import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import QuizPage from './pages/QuizPage';
import WhitePapersPage from './pages/WhitePapersPage';
import WhiteboardPage from './pages/WhiteboardPage';
import SideQuestsPage from './pages/SideQuestsPage';
import PlaygroundsPage from './pages/PlaygroundsPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectModulePage from './pages/ProjectModulePage';
import MinorsPage from './pages/MinorsPage';
import SparkPlaygroundPage from './pages/SparkPlaygroundPage';
import SparkPlaygroundOpenPage from './pages/SparkPlaygroundOpenPage';
import SparkPrimerPage from './pages/SparkPrimerPage';
import K8sPrimerPage from './pages/K8sPrimerPage';
import K8sReadingPage from './pages/K8sReadingPage';
import ProfilePage from './pages/ProfilePage';
import DbExplorerPage from './pages/DbExplorerPage';
import AppLayout from './layouts/AppLayout';
import { AppStateProvider } from './context/AppStateContext';
import { getToken, getCurrentUser, logout } from './services/authApi';
import { fetchChallenges, fetchChallenge } from './services/challengeApi';
import { startSession, startBoardSession, endSession, restoreSession } from './services/sessionApi';
import { startSparkSession, startK8sSession } from './services/workspaceApi';
import { buildDailyProductSalesProject } from './fixtures/dailyProductSalesL1';
import {
  buildSparkPlaygroundChallenge,
  buildSparkPlaygroundStarter,
} from './fixtures/sparkPlaygroundStarter';
import { isSparkPlatformChallenge } from './components/SparkPlatformWorkspace';
import { isBoardChallenge } from './components/BoardWorkspace';
import { isKubernetesChallenge } from './components/K8sLabWorkspace';
import { SPARK_PLAYGROUND_CHALLENGE_ID } from './constants/playgroundDatasets';
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

function LegacyMajorsRedirect(): JSX.Element {
  const { pathname } = useLocation();
  return <Navigate to={pathname.replace(/^\/play\/projects/, '/play/majors')} replace />;
}

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
  const [closingLabTitle, setClosingLabTitle] = useState<string | null>(null);
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

  const refreshChallenges = async (): Promise<void> => {
    try {
      const list = await fetchChallenges();
      setChallenges(list);
      setChallengesError(null);
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setChallenges([]);
      setChallengesError(err?.response?.data?.error || err.message || 'Unknown error');
    }
  };

  /** Leaving the UI used to drop client state only — end on the server so K8s can park/wipe. */
  const endActiveSessionBestEffort = useCallback((session: ActiveSession | null): Promise<void> => {
    if (!session?.id || session.id.startsWith('pending-k8s-')) return Promise.resolve();
    return endSession(session.id).then(
      () => undefined,
      (err: unknown) => {
        console.warn('[session] end on leave failed', err);
      },
    );
  }, []);

  /**
   * Fire-and-forget end/park, reveal catalog immediately, hold a centered loader ~2s.
   */
  const dismissK8sLabToCatalog = useCallback(async (
    session: ActiveSession,
    dest: string,
    title: string | null,
  ): Promise<void> => {
    setClosingLabTitle(title);
    setEnding(true);
    void endActiveSessionBestEffort(session);
    setPlayState('library');
    setActiveSession(null);
    setActiveChallenge(null);
    setEndResult(null);
    navigate(dest);
    void refreshChallenges();
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 2000);
    });
    setEnding(false);
    setClosingLabTitle(null);
  }, [endActiveSessionBestEffort, navigate]);

  useEffect(() => {
    if (authMode === 'interviewer') {
      void refreshChallenges();
    }
  }, [authMode]);

  const handleSelectChallenge = async (challenge: ChallengePublic | ChallengeFull): Promise<void> => {
    setStartError(null);
    setActiveChallenge(challenge);
    // K8s: open the lab UI immediately (no full-page loader). Other runtimes keep the spinner.
    if (!isKubernetesChallenge(challenge)) {
      setPlayState('loading');
    }

    if (isBoardChallenge(challenge)) {
      try {
        const full = await fetchChallenge(challenge.id);
        const res = await startBoardSession(full.id);
        const hydrated =
          (res.challenge as ChallengeFull | undefined)
          || (res.session as { challenge?: ChallengeFull } | undefined)?.challenge
          || full;
        setActiveSession({
          id: res.sessionId,
          startTime: Date.now(),
          recovered: false,
          terminalWsUrl: null,
          metricsWsUrl: null,
          portMap: null,
          services: [],
          terminalService: null,
          runtime: 'board',
        });
        setActiveChallenge(hydrated);
        openingSessionRef.current = res.sessionId;
        setPlayState('active');
        navigate(`/play/${res.sessionId}`);
      } catch (e) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        setActiveChallenge(null);
        setActiveSession(null);
        setPlayState('library');
        navigate(catalogPathForChallenge(challenge.id, challenge.sandboxType, challenge.tags), { replace: true });
        setStartError(
          err?.response?.data?.error
            || err.message
            || 'Failed to start board session',
        );
      }
      return;
    }

    // Spark-platform: hydrate meta from MinIO; seed starter from MinIO when contentSource=minio.
    if (isSparkPlatformChallenge(challenge)) {
      try {
        const full = await fetchChallenge(challenge.id);
        const platform = full.sparkPlatform;
        const contentSource = full.contentSource || platform?.contentSource;
        // MinIO SSOT labs: backend loads challenges/<id>/starter/.
        // Legacy labs (e.g. DPS) still use FE fixtures until migrated.
        const useMinioStarter = contentSource === 'minio';
        if (!useMinioStarter && !platform) {
          throw new Error('Missing sparkPlatform spec');
        }
        const starterFiles = useMinioStarter
          ? null
          : buildDailyProductSalesProject(platform!);
        const res = await startSparkSession(
          full.id,
          starterFiles,
          platform?.starterFileName,
        );
        const hydrated =
          (res.challenge as ChallengeFull | undefined)
          || (res.session as { challenge?: ChallengeFull } | undefined)?.challenge
          || full;
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
        setActiveChallenge(hydrated);
        setActiveTab('editor');
        openingSessionRef.current = res.sessionId;
        setPlayState('active');
        navigate(`/play/${res.sessionId}`);
      } catch (e) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        setActiveChallenge(null);
        setActiveSession(null);
        setPlayState('library');
        navigate(catalogPathForChallenge(challenge.id, challenge.sandboxType, challenge.tags), { replace: true });
        setStartError(
          err?.response?.data?.error
            || err.message
            || 'Failed to start spark session (MinIO unreachable)',
        );
      }
      return;
    }

    if (isKubernetesChallenge(challenge)) {
      const pendingId = `pending-k8s-${challenge.id}`;
      setActiveTab('problem');
      setActiveSession({
        id: pendingId,
        startTime: Date.now(),
        recovered: false,
        terminalWsUrl: null,
        metricsWsUrl: null,
        portMap: null,
        services: [],
        terminalService: null,
        runtime: 'kubernetes',
        k8sNamespace: null,
        labReady: false,
      });
      setPlayState('active');
      openingSessionRef.current = pendingId;

      try {
        const full = await fetchChallenge(challenge.id);
        setActiveChallenge(full);

        const res = await startK8sSession(full.id);
        const hydrated =
          (res.challenge as ChallengeFull | undefined)
          || (res.session as { challenge?: ChallengeFull } | undefined)?.challenge
          || full;
        setActiveSession({
          id: res.sessionId,
          startTime: Date.now(),
          recovered: false,
          terminalWsUrl: res.terminalWsUrl ?? null,
          metricsWsUrl: null,
          portMap: null,
          services: [],
          terminalService: null,
          runtime: 'kubernetes',
          k8sNamespace: res.k8sNamespace
            || (res.session as { k8sNamespace?: string } | undefined)?.k8sNamespace
            || null,
          labReady: true,
        });
        setActiveChallenge(hydrated);
        openingSessionRef.current = res.sessionId;
        navigate(`/play/${res.sessionId}`);
      } catch (e) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        setActiveChallenge(null);
        setActiveSession(null);
        setPlayState('library');
        navigate(catalogPathForChallenge(challenge.id, challenge.sandboxType, challenge.tags), { replace: true });
        setStartError(
          err?.response?.data?.error
            || err.message
            || 'Failed to start Kubernetes lab session',
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
      navigate(catalogPathForChallenge(challenge.id, challenge.sandboxType, challenge.tags), { replace: true });
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

    // Quiz / papers / quests / playgrounds / majors / minors — not session restore paths
    if (
      a === 'quiz' ||
      a === 'papers' ||
      a === 'quests' ||
      a === 'whiteboard' ||
      a === 'playgrounds' ||
      a === 'projects' ||
      a === 'majors' ||
      a === 'minors' ||
      a === 'spark-playground'
    ) {
      return;
    }

    // Catalog: /play | /play/:domain | /play/:domain/:panel
    if (!a || isPlayDomainId(a)) {
      if (playState === 'loading') return;
      if (openingSessionRef.current) return;
      if (ending) return;
      if (playState === 'active' || playState === 'ended') {
        const leaving = playState === 'active' ? activeSession : null;
        if (leaving?.runtime === 'kubernetes') {
          const dest = location.pathname.replace(/\/$/, '') || '/play';
          void dismissK8sLabToCatalog(
            leaving,
            dest.startsWith('/play') ? dest : '/play',
            activeChallenge?.title || null,
          );
          return;
        }
        setPlayState('library');
        setActiveSession(null);
        setActiveChallenge(null);
        setEndResult(null);
        if (leaving) void endActiveSessionBestEffort(leaving);
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
        const runtime =
          (res?.session as { runtime?: string } | null | undefined)?.runtime ||
          (res as { runtime?: string } | null | undefined)?.runtime ||
          null;

        if (runtime === 'board' || isBoardChallenge(res?.challenge || null)) {
          await restoreBoardWorkspace(sessionId, res);
          return;
        }

        if (runtime === 'kubernetes' || isKubernetesChallenge(res?.challenge || null)) {
          const sess = res?.session as {
            recovered?: boolean;
            k8sNamespace?: string;
            workspacePrefix?: string;
          } | null | undefined;
          setActiveSession({
            id: res?.sessionId || sessionId,
            startTime: res?.startTime || Date.now(),
            recovered: sess?.recovered ?? false,
            terminalWsUrl: res?.terminalWsUrl ?? null,
            metricsWsUrl: null,
            portMap: null,
            services: [],
            terminalService: null,
            runtime: 'kubernetes',
            k8sNamespace: sess?.k8sNamespace
              || (res as { k8sNamespace?: string } | null)?.k8sNamespace
              || sess?.workspacePrefix
              || null,
            labReady: true,
          });
          setActiveChallenge((res?.challenge as ChallengeFull | null) || null);
          setActiveTab('problem');
          setPlayState('active');
          return;
        }

        if (!res || res.status === 'ended') {
          await restoreSparkWorkspace(sessionId, null);
          return;
        }

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

    async function restoreBoardWorkspace(
      sid: string,
      sessionRes: Awaited<ReturnType<typeof restoreSession>>,
    ): Promise<void> {
      const challengeId =
        (sessionRes?.session as { challengeId?: string } | null | undefined)?.challengeId ||
        sessionRes?.challenge?.id ||
        null;
      let full: ChallengeFull | ChallengePublic | null = sessionRes?.challenge || null;
      if (challengeId) {
        try {
          full = await fetchChallenge(challengeId);
        } catch {
          /* keep session challenge payload */
        }
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
        runtime: 'board',
      });
      setActiveChallenge(full);
      setPlayState('active');
    }

    async function restoreSparkWorkspace(
      sid: string,
      sessionRes: Awaited<ReturnType<typeof restoreSession>>,
    ): Promise<void> {
      const challengeId =
        (sessionRes?.session as { challengeId?: string } | null | undefined)?.challengeId ||
        sessionRes?.challenge?.id ||
        null;

      let full: ChallengeFull | null = null;
      if (challengeId === SPARK_PLAYGROUND_CHALLENGE_ID) {
        full = buildSparkPlaygroundChallenge();
      } else if (challengeId) {
        full = await fetchChallenge(challengeId);
      } else {
        // Workspace exists without a recoverable challenge id — probe MinIO then default lab.
        const { fetchWorkspace } = await import('./services/workspaceApi');
        await fetchWorkspace(sid);
        full = await fetchChallenge('l1-filter-valid-sales-rows');
      }

      if (challengeId !== SPARK_PLAYGROUND_CHALLENGE_ID && !full?.sparkPlatform && full) {
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
    if (!activeSession || ending) return;
    if (activeSession.id.startsWith('pending-k8s-')) {
      setActiveSession(null);
      setActiveChallenge(null);
      setPlayState('library');
      setEnding(false);
      return;
    }
    setEnding(true);
    try {
      if (activeSession.runtime === 'board') {
        const res = await endSession(activeSession.id);
        setEndResult(res as EndSessionResult);
        setPlayState('ended');
        return;
      }
      if (activeSession.runtime === 'spark-platform' || activeSession.id.startsWith('spark-')) {
        try {
          await endSession(activeSession.id);
        } catch (_e) {
          /* still close UI */
        }
        setEndResult({
          sessionId: activeSession.id,
          elapsed: Date.now() - activeSession.startTime,
        });
        setPlayState('ended');
        return;
      }
      if (activeSession.runtime === 'kubernetes') {
        const dest = catalogPathForChallenge(
          activeChallenge?.id,
          activeChallenge?.sandboxType,
          activeChallenge?.tags,
        );
        await dismissK8sLabToCatalog(activeSession, dest, activeChallenge?.title || null);
        return;
      }
      // compose: end on server, then summary card
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

  const handleOpenSparkPlayground = async (): Promise<void> => {
    setStartError(null);
    setPlayState('loading');
    const challenge = buildSparkPlaygroundChallenge();
    try {
      const res = await startSparkSession(
        SPARK_PLAYGROUND_CHALLENGE_ID,
        buildSparkPlaygroundStarter(),
        'src/main.py',
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
      setActiveChallenge(challenge);
      setActiveTab('editor');
      openingSessionRef.current = res.sessionId;
      setPlayState('active');
      navigate(`/play/${res.sessionId}`);
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setActiveChallenge(null);
      setActiveSession(null);
      setPlayState('library');
      setStartError(
        err?.response?.data?.error
          || err.message
          || 'Failed to open Spark Playground',
      );
      navigate('/play/spark-playground', { replace: true });
      throw e;
    }
  };

  const handleBackToLibrary = (): void => {
    const dest = catalogPathForChallenge(activeChallenge?.id, activeChallenge?.sandboxType, activeChallenge?.tags);
    const leaving = playState === 'active' ? activeSession : null;
    if (leaving?.runtime === 'kubernetes') {
      if (ending) return;
      void dismissK8sLabToCatalog(leaving, dest, activeChallenge?.title || null);
      return;
    }
    setPlayState('library');
    setActiveSession(null);
    setActiveChallenge(null);
    setEndResult(null);
    navigate(dest);
    if (leaving) void endActiveSessionBestEffort(leaving);
    void refreshChallenges();
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
    closingLabTitle,
    onSelectChallenge: handleSelectChallenge,
    onOpenSparkPlayground: handleOpenSparkPlayground,
    onBackToLibrary: handleBackToLibrary,
    onEnd: handleEnd,
    onLogout: handleLogout,
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
    closingLabTitle,
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

  return (
    <AppStateProvider value={appState}>
      <Routes>
        <Route path="/" element={<Navigate to="/play" replace />} />
        <Route element={<AppLayout />}>
          <Route path="play" element={<PlayPage />} />
          <Route path="play/quiz/:quizId" element={<QuizPage />} />
          <Route path="play/papers" element={<WhitePapersPage />} />
          <Route path="play/papers/:sectionId" element={<WhitePapersPage />} />
          <Route path="play/whiteboard" element={<WhiteboardPage />} />
          <Route path="play/whiteboard/:sectionId" element={<WhiteboardPage />} />
          <Route path="play/quests" element={<SideQuestsPage />} />
          <Route path="play/quests/:topicId" element={<SideQuestsPage />} />
          <Route path="play/playgrounds" element={<PlaygroundsPage />} />
          <Route path="play/majors" element={<ProjectsPage />} />
          <Route path="play/majors/:projectId" element={<ProjectsPage />} />
          <Route path="play/majors/:projectId/:moduleId" element={<ProjectModulePage />} />
          <Route path="play/projects/*" element={<LegacyMajorsRedirect />} />
          <Route path="play/projects" element={<Navigate to="/play/majors" replace />} />
          <Route path="play/minors" element={<MinorsPage />} />
          <Route path="play/minors/:minorId" element={<MinorsPage />} />
          <Route path="play/spark-playground/open" element={<SparkPlaygroundOpenPage />} />
          <Route path="play/spark-playground" element={<SparkPlaygroundPage />} />
          <Route path="play/data-engineer/spark/intro" element={<SparkPrimerPage />} />
          <Route path="play/devops-engineer/kubernetes/intro" element={<K8sPrimerPage />} />
          <Route
            path="play/devops-engineer/kubernetes/read/:readingSlug"
            element={<K8sReadingPage />}
          />
          <Route path="play/:domainId" element={<PlayPage />} />
          <Route path="play/:domainId/:panelId" element={<PlayPage />} />
          <Route path="profile" element={<ProfilePage />} />
          {import.meta.env.DEV && (
            <Route path="dev/db" element={<DbExplorerPage />} />
          )}
        </Route>
        <Route path="*" element={<Navigate to="/play" replace />} />
      </Routes>
    </AppStateProvider>
  );
}
