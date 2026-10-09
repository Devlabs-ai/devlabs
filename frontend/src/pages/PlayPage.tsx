import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import SandboxWorkspace from '../components/SandboxWorkspace';
import SparkPlatformWorkspace, {
  isSparkPlatformChallenge,
} from '../components/SparkPlatformWorkspace';
import BoardWorkspace, { isBoardChallenge } from '../components/BoardWorkspace';
import K8sLabWorkspace, {
  boxMachineLabel,
  isBoxChallenge,
  isKubernetesChallenge,
} from '../components/K8sLabWorkspace';
import {
  LeaderboardIcon,
  PrimerGuideIcon,
  RoadmapIcon,
  StatusBookIcon,
} from '../components/TrackStatusIcons';
import TrackLeaderboardModal from '../components/TrackLeaderboardModal';
import MonthlyPaperCard, { MonthlyPaperBanner } from '../components/MonthlyPaperCard';
import PlatformLeaderboardCard from '../components/PlatformLeaderboardCard';
import TrackRoadmapModal from '../components/TrackRoadmapModal';
import { buildPanelRoadmapNodes } from '../lib/trackRoadmapNodes';
import { useIsNarrowUi } from '../hooks/useMediaQuery';
import { IconCoins, IconLock } from '../components/ChromeIcons';
import {
  PLAY_DOMAINS,
  getPlayDomain,
  getPlayPanel,
  isPlayDomainId,
  listPlayCatalogEntries,
  looksLikePlaySessionId,
  playCatalogPath,
  type PlayDomain,
  type PlayDomainId,
  type PlayPanel,
} from '../constants/playCatalog';
import { WHITEBOARD_PATH } from '../constants/whiteboard';
import { SPARK_PRIMER_PATH } from '../constants/sparkPrimer';
import { K8S_PRIMER_PATH } from '../constants/k8sPrimer';
import type { K8sTrackItem } from '../constants/k8sReadings';
import { readingTrackForPanel } from '../constants/readingTracks';
import type { ChallengePublic } from '../types/domain';
import { isAdminUser, isReviewStaff, getCurrentUser } from '../services/authApi';
import { visibilityMark } from '../constants/roles';

function panelPrimerPath(panelId: string): string | null {
  if (panelId === 'spark') return SPARK_PRIMER_PATH;
  if (panelId === 'kubernetes') return K8S_PRIMER_PATH;
  return null;
}

function panelLabCount(panel: PlayPanel): number {
  return panel.challengeIds.length;
}

function domainLabCount(domain: PlayDomain): number {
  if (domain.comingSoon) return 0;
  return domain.panels.reduce((n, p) => n + panelLabCount(p), 0);
}

type KindFilter = 'all' | 'blog' | 'lab';

interface LibraryViewProps {
  challenges: ChallengePublic[];
  challengesError: string | null;
  startError: string | null;
  onSelectChallenge: (challenge: ChallengePublic) => void | Promise<void>;
}

/**
 * Lab number from challenge id (source of truth), e.g. k8s-25-… → "25".
 * Prefer id over problemStatement.idLabel so a stale DB/catalog cannot drift
 * from pack folders / solution filenames (*-l25.yaml).
 */
function catalogIdLabel(challenge: ChallengePublic): string {
  const fromK8sId = /^(?:k8s|linux|docker)-0*(\d+)-/i.exec(challenge.id)?.[1];
  if (fromK8sId) return String(Number(fromK8sId)); // "02" → "2", "25" → "25"
  if (/^l1-/i.test(challenge.id)) return '1';
  const ps = challenge.problemStatement;
  const fromPs =
    ps && typeof ps === 'object' && typeof (ps as { idLabel?: unknown }).idLabel === 'string'
      ? (ps as { idLabel: string }).idLabel.trim()
      : '';
  if (fromPs) return fromPs;
  return '—';
}

function labTrackId(challenge: ChallengePublic): string {
  const label = catalogIdLabel(challenge);
  return label === '—' ? '—' : `L${label}`;
}

function LibraryView({ challenges, challengesError, startError, onSelectChallenge }: LibraryViewProps): JSX.Element {
  const navigate = useNavigate();
  const { currentUser } = useAppState();
  const isAdmin = isAdminUser(currentUser) || isAdminUser(getCurrentUser());
  const showVisibilityMarks =
    isAdmin ||
    isReviewStaff(currentUser) ||
    isReviewStaff(getCurrentUser());
  const params = useParams<{ domainId?: string; panelId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('lab');
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const isNarrowUi = useIsNarrowUi();
  const showRoadmap = !isNarrowUi;

  const domainId =
    isPlayDomainId(params.domainId) && !getPlayDomain(params.domainId)?.comingSoon
      ? (params.domainId as PlayDomainId)
      : null;
  const domain = getPlayDomain(domainId);
  const panel = getPlayPanel(domain, params.panelId || null);
  const isTracksHub = !domainId;
  const isDomainHub = Boolean(domainId && domain && !panel);
  const readingTrack = readingTrackForPanel(domainId, panel?.id);

  useEffect(() => {
    if (params.domainId && !domainId) {
      if (looksLikePlaySessionId(params.domainId)) return;
      navigate('/track', { replace: true });
      return;
    }
    if (domainId && params.panelId && !panel) {
      navigate(playCatalogPath(domainId), { replace: true });
    }
  }, [params.domainId, params.panelId, domainId, panel, navigate]);

  useEffect(() => {
    if (isNarrowUi) setRoadmapOpen(false);
  }, [isNarrowUi]);

  const byId = useMemo(() => {
    const map = new Map<string, ChallengePublic>();
    for (const c of challenges) map.set(c.id, c);
    return map;
  }, [challenges]);

  // Deep-link from readings: /<panel>?start=<challengeId>
  useEffect(() => {
    if (!readingTrack) return;
    const startId = searchParams.get('start');
    if (!startId) return;
    const challenge = byId.get(startId);
    if (!challenge || !challenge.finalized) return;
    const next = new URLSearchParams(searchParams);
    next.delete('start');
    setSearchParams(next, { replace: true });
    void onSelectChallenge(challenge);
  }, [readingTrack, searchParams, setSearchParams, byId, onSelectChallenge]);

  const catalogRows = useMemo(() => {
    return listPlayCatalogEntries()
      .map((entry) => {
        const challenge = byId.get(entry.challengeId);
        if (!challenge) return null;
        if (isBoardChallenge(challenge)) return null;
        return { ...entry, challenge };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [byId]);

  const activeTopicId = panel?.id || null;
  const showLabList = Boolean(domainId && panel);
  const primerPath = panel ? panelPrimerPath(panel.id) : null;

  const roadmapNodes = useMemo(() => {
    if (!panel) return [];
    return buildPanelRoadmapNodes(panel, readingTrack, byId);
  }, [panel, readingTrack, byId]);

  type TrackRow =
    | {
        kind: 'reading';
        key: string;
        trackId: string;
        title: string;
        href: string;
      }
    | {
        kind: 'challenge';
        key: string;
        challenge: ChallengePublic;
        trackId: string;
      };

  const filteredRows = useMemo((): TrackRow[] => {
    if (!showLabList) return [];
    const q = search.trim().toLowerCase();

    if (readingTrack) {
      const items = readingTrack.listTrackItems();
      const rows: TrackRow[] = [];
      for (const item of items) {
        if (item.type === 'reading') {
          if (kindFilter === 'lab') continue;
          const reading = readingTrack.getReading(item.readingId);
          if (!reading) continue;
          if (reading.gatedByChallengeId && !byId.has(reading.gatedByChallengeId)) continue;
          if (q) {
            const hay = [reading.trackId, reading.title, reading.lede, 'blog', 'reading']
              .join(' ')
              .toLowerCase();
            if (!hay.includes(q)) continue;
          }
          rows.push({
            kind: 'reading',
            key: item.id,
            trackId: reading.trackId,
            title: reading.title,
            href: readingTrack.readingPath(reading.slug),
          });
          continue;
        }
        if (kindFilter === 'blog') continue;
        const challenge = byId.get(item.challengeId);
        if (!challenge || isBoardChallenge(challenge)) continue;
        const trackId = labTrackId(challenge);
        if (q) {
          const hay = [
            trackId,
            challenge.title,
            challenge.description,
            challenge.difficulty,
            'lab',
            ...(challenge.tags || []),
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) continue;
        }
        rows.push({
          kind: 'challenge',
          key: item.id,
          challenge,
          trackId,
        });
      }
      return rows;
    }

    if (kindFilter === 'blog') return [];

    const rows: TrackRow[] = [];
    for (const row of catalogRows) {
      if (domainId && row.domainId !== domainId) continue;
      if (activeTopicId && row.panelId !== activeTopicId) continue;
      const trackId = labTrackId(row.challenge);
      if (q) {
        const hay = [
          trackId,
          row.challenge.title,
          row.challenge.description,
          row.challenge.difficulty,
          'lab',
          row.panelLabel,
          ...(row.challenge.tags || []),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) continue;
      }
      rows.push({
        kind: 'challenge',
        key: row.challenge.id,
        challenge: row.challenge,
        trackId,
      });
    }
    return rows;
  }, [
    catalogRows,
    domainId,
    activeTopicId,
    kindFilter,
    search,
    showLabList,
    readingTrack,
    byId,
  ]);

  const availableInPanel = useMemo(() => {
    if (!showLabList || !domainId || !activeTopicId) return 0;
    if (readingTrack) {
      return readingTrack.listTrackItems().filter((item: K8sTrackItem) => {
        if (item.type === 'reading') {
          const gate = readingTrack.getReading(item.readingId)?.gatedByChallengeId;
          return !gate || byId.has(gate);
        }
        return byId.has(item.challengeId);
      }).length;
    }
    return catalogRows.filter(
      (row) => row.domainId === domainId && row.panelId === activeTopicId,
    ).length;
  }, [catalogRows, domainId, activeTopicId, showLabList, readingTrack, byId]);

  return (
    <div className="app-page play-problems-page play-problems-page--fixed">
      {challengesError && <div className="alert app-page-alert">{challengesError}</div>}
      {startError && <div className="alert app-page-alert">Failed to start: {startError}</div>}

      <h1 className="sr-only">Play</h1>

      <div className="play-problems-layout">
        <aside
          className="play-problems-sidebar"
          aria-label={isAdmin ? 'Paper of the Month, Whiteboard and leaderboard' : 'Paper of the Month and leaderboard'}
        >
          <MonthlyPaperCard />
          {isAdmin && (
            <Link to={WHITEBOARD_PATH} className="play-sidebar-card play-sidebar-papers play-sidebar-board">
              <strong>Whiteboard</strong>
              <p>Data systems theory: replication, consensus, transactions and more. No cluster.</p>
              <span className="play-sidebar-papers-cta">
                Browse boards
                <span aria-hidden>→</span>
              </span>
            </Link>
          )}
          <PlatformLeaderboardCard />
        </aside>

        <main className="play-problems-main">
          <MonthlyPaperBanner />
          {isTracksHub && (
            <section className="play-hub" aria-label="Tracks">
              <header className="play-hub-header">
                <p className="play-problems-kicker">Tracks</p>
                <h2 className="play-hub-title">Pick a track</h2>
                <p className="play-hub-lead">
                  Browse labs by role track — open a category, then a technology shelf.
                </p>
              </header>
              <div className="play-paper-section-grid" aria-label="Track categories">
                {PLAY_DOMAINS.map((d) => {
                  const count = domainLabCount(d);
                  const empty = d.panels.length === 0 || count === 0;
                  if (empty) {
                    return (
                      <div
                        key={d.id}
                        className="play-paper-section-card play-paper-tile--soon"
                        title="Coming soon"
                      >
                        <span className="play-paper-section-kicker">Soon</span>
                        <strong className="play-paper-section-title">{d.label}</strong>
                        <p className="play-paper-section-blurb">{d.blurb}</p>
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={d.id}
                      to={playCatalogPath(d.id)}
                      className="play-paper-section-card"
                    >
                      <span className="play-paper-section-kicker">
                        {count} lab{count === 1 ? '' : 's'}
                      </span>
                      <strong className="play-paper-section-title">{d.label}</strong>
                      <p className="play-paper-section-blurb">{d.blurb}</p>
                      <span className="play-paper-section-cta">
                        Browse track
                        <span aria-hidden>→</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {isDomainHub && domain && (
            <section className="play-hub" aria-label={`${domain.label} shelves`}>
              <header className="play-hub-header">
                <h2 className="play-hub-title">{domain.label}</h2>
                <p className="play-hub-lead">{domain.blurb}</p>
              </header>
              <div className="play-paper-section-grid" aria-label={`${domain.label} categories`}>
                {domain.panels.map((p) => {
                  const count = panelLabCount(p);
                  if (count === 0) {
                    return (
                      <div
                        key={p.id}
                        className="play-paper-section-card play-paper-tile--soon"
                        title="Coming soon"
                      >
                        <span className="play-paper-section-kicker">Soon</span>
                        <strong className="play-paper-section-title">{p.label}</strong>
                        <p className="play-paper-section-blurb">{p.blurb}</p>
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={p.id}
                      to={playCatalogPath(domain.id, p.id)}
                      className="play-paper-section-card"
                    >
                      <span className="play-paper-section-kicker">
                        {count} lab{count === 1 ? '' : 's'}
                      </span>
                      <strong className="play-paper-section-title">{p.label}</strong>
                      <p className="play-paper-section-blurb">{p.blurb}</p>
                      <span className="play-paper-section-cta">
                        Open labs
                        <span aria-hidden>→</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {showLabList && domain && panel && (
            <>
              <header className="play-hub-header play-hub-header--compact">
                <div className="play-hub-title-row">
                  <h2 className="play-hub-title">{panel.label}</h2>
                  <div className="play-hub-title-actions">
                    {primerPath && (
                      <Link
                        to={primerPath}
                        className="play-primer-link"
                        aria-label="Read the primer"
                        title="Read the primer"
                      >
                        <PrimerGuideIcon className="play-primer-link-icon" title="" />
                      </Link>
                    )}
                    {showRoadmap && roadmapNodes.length > 0 && (
                      <button
                        type="button"
                        className="play-primer-link play-roadmap-link"
                        aria-label={`${panel.label} roadmap`}
                        title="Roadmap"
                        onClick={() => setRoadmapOpen(true)}
                      >
                        <RoadmapIcon className="play-primer-link-icon" title="" />
                      </button>
                    )}
                    {panel.challengeIds.length > 0 && (
                      <button
                        type="button"
                        className="play-primer-link play-leaderboard-link"
                        aria-label={`${panel.label} leaderboard`}
                        title="Leaderboard"
                        onClick={() => setLeaderboardOpen(true)}
                      >
                        <LeaderboardIcon className="play-primer-link-icon" title="" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="play-hub-lead">{panel.blurb}</p>
              </header>
              <TrackLeaderboardModal
                open={leaderboardOpen}
                trackLabel={panel.label}
                challengeIds={panel.challengeIds}
                fullPath={`${playCatalogPath(domain.id, panel.id)}/leaderboard`}
                onClose={() => setLeaderboardOpen(false)}
              />
              {showRoadmap ? (
                <TrackRoadmapModal
                  open={roadmapOpen}
                  trackLabel={panel.label}
                  nodes={roadmapNodes}
                  onClose={() => setRoadmapOpen(false)}
                  onSelectLab={onSelectChallenge}
                />
              ) : null}

              <section className="play-problems-toolbar">
                <label className="play-search">
                  <span className="sr-only">Search track</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search track…"
                  />
                </label>
                <div className="play-kind-toggle" role="group" aria-label="Kind">
                  <button
                    type="button"
                    className={`play-kind-toggle-btn${kindFilter === 'lab' ? ' is-active' : ''}`}
                    aria-pressed={kindFilter === 'lab'}
                    onClick={() => setKindFilter('lab')}
                  >
                    Lab
                  </button>
                  <button
                    type="button"
                    className={`play-kind-toggle-btn${kindFilter === 'blog' ? ' is-active' : ''}`}
                    aria-pressed={kindFilter === 'blog'}
                    onClick={() => setKindFilter('blog')}
                  >
                    Blog
                  </button>
                </div>
              </section>

              <section className="play-problems-table-wrap" aria-label={`${panel.label} track`}>
                <div className="play-problems-table-head">
                  <span>ID</span>
                  <span>Title</span>
                  <span className="play-problems-col-tokens" aria-hidden="true" />
                </div>
                {filteredRows.length === 0 ? (
                  <div className="play-problems-empty">
                    {availableInPanel === 0
                      ? 'No items loaded for this shelf yet.'
                      : 'No items match these filters.'}
                  </div>
                ) : (
                  <ul className="play-problems-table">
                    {filteredRows.map((row) => {
                      if (row.kind === 'reading') {
                        return (
                          <li key={row.key}>
                            <button
                              type="button"
                              className="play-problem-row play-problem-row--reading"
                              onClick={() => navigate(row.href)}
                            >
                              <span className="play-problem-id" title={row.trackId}>
                                {row.trackId}
                              </span>
                              <span className="play-problem-title">{row.title}</span>
                              <span className="play-problem-meta" aria-label="Blog">
                                <StatusBookIcon className="play-problem-status-icon play-problem-meta-book" />
                              </span>
                            </button>
                          </li>
                        );
                      }

                      const { challenge, trackId } = row;
                      const playable = Boolean(challenge.finalized);
                      const solved = Boolean(challenge.solved);
                      const locked = Boolean(challenge.locked);
                      const vis = visibilityMark(challenge.visibleTo);
                      const tokens =
                        typeof challenge.tokens === 'number' && Number.isFinite(challenge.tokens)
                          ? challenge.tokens
                          : 10;
                      return (
                        <li key={row.key}>
                          <button
                            type="button"
                            className={`play-problem-row play-problem-row--lab${playable ? '' : ' disabled'}${solved ? ' is-solved' : ''}${locked ? ' is-locked' : ''}`}
                            disabled={!playable}
                            title={locked ? 'Subscribe to unlock this lab' : undefined}
                            onClick={() => {
                              if (playable) void onSelectChallenge(challenge);
                            }}
                          >
                            <span className="play-problem-id" title={challenge.id}>
                              {trackId}
                            </span>
                            <span className="play-problem-title">
                              {challenge.title}
                              {locked ? (
                                <span className="play-problem-lock" aria-label="Locked">
                                  <IconLock size={13} />
                                </span>
                              ) : null}
                            </span>
                            <span
                              className={`play-problem-meta${showVisibilityMarks ? ' play-problem-meta--staff' : ''}`}
                            >
                              {showVisibilityMarks ? (
                                <span
                                  className={`play-visibility-badge play-visibility-badge--${vis.key}`}
                                  title={vis.label}
                                  aria-label={vis.label}
                                >
                                  {vis.letter}
                                </span>
                              ) : null}
                              {challenge.k8sPlatform?.practice ? null : (
                                <span className="play-problem-tokens" title={`${tokens} tokens`}>
                                  <span className="play-problem-tokens-coin">
                                    <IconCoins size={14} />
                                  </span>
                                  {tokens}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default function PlayPage(): JSX.Element | null {
  const {
    playState,
    challenges,
    challengesError,
    startError,
    activeSession,
    activeChallenge,
    endResult,
    onSelectChallenge,
    onBackToLibrary,
    onEnd,
    ending,
    closingLabTitle,
  } = useAppState();
  const params = useParams<{ domainId?: string; panelId?: string }>();
  const restoringSession =
    playState === 'library' &&
    Boolean(params.domainId) &&
    !params.panelId &&
    looksLikePlaySessionId(params.domainId);

  if (restoringSession || playState === 'loading') {
    const spark = isSparkPlatformChallenge(activeChallenge);
    const board = isBoardChallenge(activeChallenge);
    const k8s = isKubernetesChallenge(activeChallenge);
    return (
      <div className="app-page app-page-centered">
        <div className="loading-card app-surface-card">
          <span className="spinner" />
          <div>
            {board ? (
              <>
                Opening board for <strong>{activeChallenge?.title}</strong>…
                <div style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 6 }}>
                  No cluster — fill the empty blocks from Unused.
                </div>
              </>
            ) : isBoxChallenge(activeChallenge) ? (
              <>
                Opening {boxMachineLabel(activeChallenge)} lab for <strong>{activeChallenge?.title}</strong>…
                <div style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 6 }}>
                  Booting a fresh machine for you (up to two minutes on a cold start).
                </div>
              </>
            ) : k8s ? (
              <>
                Opening Kubernetes lab for <strong>{activeChallenge?.title}</strong>…
                <div style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 6 }}>
                  Preparing your namespace on the shared cluster.
                </div>
              </>
            ) : spark ? (
              <>
                Opening Spark workspace for <strong>{activeChallenge?.title}</strong>…
                <div style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 6 }}>
                  Shared cluster session — no Docker sandbox to build.
                </div>
              </>
            ) : (
              <>
                {restoringSession ? (
                  <>Restoring session…</>
                ) : (
                  <>
                    Spinning up sandbox for <strong>{activeChallenge?.title}</strong>…
                    <div style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 6 }}>
                      This can take 30–60 seconds the first time while Docker images build.
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const closingOverlay = (overLab: boolean): JSX.Element | null => (ending ? (
    <div
      className={`lab-closing-overlay${overLab ? ' is-over-lab' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="lab-closing-toast">
        <span className="spinner" />
        <span>
          Closing lab
          {closingLabTitle ? <> · <strong>{closingLabTitle}</strong></> : null}
          …
        </span>
      </div>
    </div>
  ) : null);

  if (playState === 'library') {
    return (
      <>
        {closingOverlay(false)}
        <div className={`play-library-shell${ending ? ' lab-closing-catalog' : ''}`}>
          <LibraryView
            challenges={challenges}
            challengesError={challengesError}
            startError={startError}
            onSelectChallenge={onSelectChallenge}
          />
        </div>
      </>
    );
  }

  if (playState === 'active' && activeSession) {
    if (isBoardChallenge(activeChallenge) || activeSession.runtime === 'board') {
      return (
        <BoardWorkspace
          challenge={activeChallenge}
          session={activeSession}
          onClose={onBackToLibrary}
        />
      );
    }
    if (isKubernetesChallenge(activeChallenge) || activeSession.runtime === 'kubernetes') {
      return (
        <>
          {closingOverlay(true)}
          <K8sLabWorkspace
            challenge={activeChallenge}
            session={activeSession}
            onClose={onEnd}
          />
        </>
      );
    }
    if (isSparkPlatformChallenge(activeChallenge) || activeSession.runtime === 'spark-platform') {
      return (
        <SparkPlatformWorkspace
          challenge={activeChallenge}
          session={activeSession}
        />
      );
    }
    return (
      <SandboxWorkspace
        challenge={activeChallenge}
        session={activeSession}
        onClose={onEnd}
        closing={ending}
      />
    );
  }

  if (playState === 'ended' && endResult) {
    const spark = activeSession?.runtime === 'spark-platform';
    const board = activeSession?.runtime === 'board';
    return (
      <div className="app-page app-page-centered">
        <div className="score-card app-surface-card">
          <h2>Session ended</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 20px' }}>
            {board
              ? 'Board session closed. Open it again from Whiteboard to keep placing widgets.'
              : spark
              ? 'Platform session closed. Evaluate the candidate from job outputs and your notes.'
              : 'The sandbox has been torn down. Evaluate the candidate from your notes.'}
          </p>
          <button type="button" onClick={onBackToLibrary}>
            {board ? 'Back to Whiteboard' : 'Back to library'}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
