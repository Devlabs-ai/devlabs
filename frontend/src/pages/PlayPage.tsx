import React, { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import SandboxWorkspace from '../components/SandboxWorkspace';
import SparkPlatformWorkspace, {
  isSparkPlatformChallenge,
} from '../components/SparkPlatformWorkspace';
import BoardWorkspace, { isBoardChallenge } from '../components/BoardWorkspace';
import K8sLabWorkspace, { isKubernetesChallenge } from '../components/K8sLabWorkspace';
import {
  StatusBookIcon,
  StatusCheckIcon,
  StatusPlayIcon,
} from '../components/TrackStatusIcons';
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
// import { WHITEBOARD_PATH } from '../constants/whiteboard';
import { SPARK_PRIMER_PATH } from '../constants/sparkPrimer';
import { K8S_PRIMER_PATH } from '../constants/k8sPrimer';
import {
  getK8sReading,
  k8sReadingPath,
  listK8sTrackItems,
  type K8sTrackItem,
} from '../constants/k8sReadings';
import type { ChallengePublic } from '../types/domain';

function panelPrimerPath(panelId: string): string | null {
  if (panelId === 'spark') return SPARK_PRIMER_PATH;
  if (panelId === 'kubernetes') return K8S_PRIMER_PATH;
  return null;
}

function panelLabCount(panel: PlayPanel): number {
  return panel.challengeIds.length;
}

function domainLabCount(domain: PlayDomain): number {
  return domain.panels.reduce((n, p) => n + panelLabCount(p), 0);
}

type DifficultyFilter = 'all' | 'l0' | 'l1' | 'l2' | 'l3' | 'l4';
type KindFilter = 'all' | 'blog' | 'lab';

interface LibraryViewProps {
  challenges: ChallengePublic[];
  challengesError: string | null;
  startError: string | null;
  onSelectChallenge: (challenge: ChallengePublic) => void | Promise<void>;
}

function difficultyClass(d: string | undefined): string {
  const s = (d || '').trim().toLowerCase();
  if (s === 'l0' || s.includes('easy')) return 'l0';
  if (s === 'l1' || s.includes('medium')) return 'l1';
  if (s === 'l2') return 'l2';
  if (s === 'l3' || s.includes('hard')) return 'l3';
  if (s === 'l4') return 'l4';
  return 'l1';
}

function matchesDifficulty(challenge: ChallengePublic, filter: DifficultyFilter): boolean {
  if (filter === 'all') return true;
  return difficultyClass(challenge.difficulty) === filter;
}

function catalogIdLabel(challenge: ChallengePublic): string {
  const ps = challenge.problemStatement;
  const fromPs =
    ps && typeof ps === 'object' && typeof (ps as { idLabel?: unknown }).idLabel === 'string'
      ? (ps as { idLabel: string }).idLabel.trim()
      : '';
  if (fromPs) return fromPs;
  if (challenge.number != null) return String(challenge.number);
  return '—';
}

function LibraryView({ challenges, challengesError, startError, onSelectChallenge }: LibraryViewProps): JSX.Element {
  const navigate = useNavigate();
  const params = useParams<{ domainId?: string; panelId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

  const domainId = isPlayDomainId(params.domainId) ? (params.domainId as PlayDomainId) : null;
  const domain = getPlayDomain(domainId);
  const panel = getPlayPanel(domain, params.panelId || null);
  const isTracksHub = !domainId;
  const isDomainHub = Boolean(domainId && domain && !panel);
  const isK8sPanel = panel?.id === 'kubernetes' && domainId === 'devops-engineer';

  useEffect(() => {
    if (params.domainId && !domainId) {
      if (looksLikePlaySessionId(params.domainId)) return;
      navigate('/play', { replace: true });
      return;
    }
    if (domainId && params.panelId && !panel) {
      navigate(playCatalogPath(domainId), { replace: true });
    }
  }, [params.domainId, params.panelId, domainId, panel, navigate]);

  const byId = useMemo(() => {
    const map = new Map<string, ChallengePublic>();
    for (const c of challenges) map.set(c.id, c);
    return map;
  }, [challenges]);

  // Deep-link from readings: /kubernetes?start=<challengeId>
  useEffect(() => {
    if (!isK8sPanel) return;
    const startId = searchParams.get('start');
    if (!startId) return;
    const challenge = byId.get(startId);
    if (!challenge || !challenge.finalized) return;
    const next = new URLSearchParams(searchParams);
    next.delete('start');
    setSearchParams(next, { replace: true });
    void onSelectChallenge(challenge);
  }, [isK8sPanel, searchParams, setSearchParams, byId, onSelectChallenge]);

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

    if (isK8sPanel) {
      const items = listK8sTrackItems();
      let labOrdinal = 0;
      const rows: TrackRow[] = [];
      for (const item of items) {
        if (item.type === 'reading') {
          if (kindFilter === 'lab') continue;
          const reading = getK8sReading(item.readingId);
          if (!reading) continue;
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
            href: k8sReadingPath(reading.slug),
          });
          continue;
        }
        labOrdinal += 1;
        const trackId = `L${labOrdinal}`;
        if (kindFilter === 'blog') continue;
        const challenge = byId.get(item.challengeId);
        if (!challenge || isBoardChallenge(challenge)) continue;
        if (!matchesDifficulty(challenge, difficulty)) continue;
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

    let labOrdinal = 0;
    const rows: TrackRow[] = [];
    for (const row of catalogRows) {
      if (domainId && row.domainId !== domainId) continue;
      if (activeTopicId && row.panelId !== activeTopicId) continue;
      labOrdinal += 1;
      const trackId = `L${labOrdinal}`;
      if (!matchesDifficulty(row.challenge, difficulty)) continue;
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
    difficulty,
    kindFilter,
    search,
    showLabList,
    isK8sPanel,
    byId,
  ]);

  const availableInPanel = useMemo(() => {
    if (!showLabList || !domainId || !activeTopicId) return 0;
    if (isK8sPanel) {
      return listK8sTrackItems().filter((item: K8sTrackItem) => {
        if (item.type === 'reading') return true;
        return byId.has(item.challengeId);
      }).length;
    }
    return catalogRows.filter(
      (row) => row.domainId === domainId && row.panelId === activeTopicId,
    ).length;
  }, [catalogRows, domainId, activeTopicId, showLabList, isK8sPanel, byId]);

  return (
    <div className="app-page play-problems-page play-problems-page--fixed">
      {challengesError && <div className="alert app-page-alert">{challengesError}</div>}
      {startError && <div className="alert app-page-alert">Failed to start: {startError}</div>}

      <h1 className="sr-only">Play</h1>

      <div className="play-problems-layout">
        <aside className="play-problems-sidebar" aria-label="Tracks">
          {/*
          <NavLink to="/play/quests" className="play-sidebar-card play-sidebar-papers play-sidebar-quests">
            <strong>Side Quests</strong>
            <p>Quirkier quizzes — no code, just Spark brain snacks. Browse by topic.</p>
            <span className="play-sidebar-papers-cta">
              Browse quests
              <span aria-hidden>→</span>
            </span>
          </NavLink>

          <NavLink to={WHITEBOARD_PATH} className="play-sidebar-card play-sidebar-papers play-sidebar-board">
            <strong>Whiteboard</strong>
            <p>Reconstruct what the engine does. Fill the empty blocks — no cluster.</p>
            <span className="play-sidebar-papers-cta">
              Browse boards
              <span aria-hidden>→</span>
            </span>
          </NavLink>
          */}

          <div className="play-sidebar-card play-sidebar-explore">
            <div className="play-sidebar-section-label">Tracks</div>
            <nav className="play-sidebar-nav">
              {PLAY_DOMAINS.map((d) => {
                const count = domainLabCount(d);
                const empty = d.panels.length === 0 || count === 0;
                if (empty) {
                  return (
                    <div key={d.id} className="play-sidebar-link play-sidebar-link--muted" title="Coming soon">
                      <span>{d.label}</span>
                      <span className="play-sidebar-soon">Soon</span>
                    </div>
                  );
                }
                return (
                  <div key={d.id} className="play-sidebar-domain">
                    <NavLink
                      to={playCatalogPath(d.id)}
                      className={({ isActive }) =>
                        `play-sidebar-link${isActive && !params.panelId ? ' active' : ''}`
                      }
                    >
                      <span>{d.label}</span>
                      <span className="play-sidebar-count">{count}</span>
                    </NavLink>
                    <div className="play-sidebar-panels">
                      {d.panels.map((p) => {
                        if (p.challengeIds.length === 0) {
                          return (
                            <div key={p.id} className="play-sidebar-panel play-sidebar-panel--muted">
                              {p.label}
                            </div>
                          );
                        }
                        return (
                          <NavLink
                            key={p.id}
                            to={playCatalogPath(d.id, p.id)}
                            className={({ isActive }) =>
                              `play-sidebar-panel${isActive ? ' active' : ''}`
                            }
                          >
                            {p.label}
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>
          </div>
        </aside>

        <main className="play-problems-main">
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
                  const topics = d.panels
                    .filter((p) => p.challengeIds.length > 0)
                    .map((p) => p.label)
                    .join(' · ');
                  return (
                    <Link
                      key={d.id}
                      to={playCatalogPath(d.id)}
                      className="play-paper-section-card"
                    >
                      <span className="play-paper-section-kicker">
                        {count} lab{count === 1 ? '' : 's'}
                        {topics ? ` · ${topics}` : ''}
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
                  {primerPath && (
                    <Link to={primerPath} className="play-primer-link">
                      Read the primer
                      <span aria-hidden> →</span>
                    </Link>
                  )}
                </div>
                <p className="play-hub-lead">{panel.blurb}</p>
              </header>

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
                <select
                  className="play-filter-select"
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value as KindFilter)}
                  aria-label="Kind"
                >
                  <option value="all">Kind</option>
                  <option value="blog">Blog</option>
                  <option value="lab">Lab</option>
                </select>
                <select
                  className="play-filter-select"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as DifficultyFilter)}
                  aria-label="Level"
                >
                  <option value="all">Level</option>
                  <option value="l0">L0</option>
                  <option value="l1">L1</option>
                  <option value="l2">L2</option>
                  <option value="l3">L3</option>
                  <option value="l4">L4</option>
                </select>
              </section>

              <section className="play-problems-table-wrap" aria-label={`${panel.label} track`}>
                <div className="play-problems-table-head">
                  {/* Icon column (blog / play / completed) — no header label */}
                  <span className="play-problems-col-icon" aria-hidden="true" />
                  <span>ID</span>
                  <span>Title</span>
                  <span className="play-problems-col-kind">Kind</span>
                  <span className="play-problems-col-level">Level</span>
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
                              <span className="play-problem-status" aria-label="Open blog">
                                <StatusBookIcon className="play-problem-status-icon" />
                              </span>
                              <span className="play-problem-id" title={row.trackId}>
                                {row.trackId}
                              </span>
                              <span className="play-problem-title">{row.title}</span>
                              <span className="play-problem-topics">
                                <span className="play-topic-pill play-topic-pill--reading">
                                  Blog
                                </span>
                              </span>
                              <span className="play-problem-level play-problem-level-empty" aria-label="No level">
                                —
                              </span>
                            </button>
                          </li>
                        );
                      }

                      const { challenge, trackId } = row;
                      const playable = Boolean(challenge.finalized);
                      const solved = Boolean(challenge.solved);
                      return (
                        <li key={row.key}>
                          <button
                            type="button"
                            className={`play-problem-row play-problem-row--lab${playable ? '' : ' disabled'}${solved ? ' is-solved' : ''}`}
                            disabled={!playable}
                            onClick={() => {
                              if (playable) void onSelectChallenge(challenge);
                            }}
                          >
                            <span
                              className={`play-problem-status${solved ? ' is-solved' : ''}`}
                              aria-label={solved ? 'Completed' : 'Open lab'}
                            >
                              {solved ? (
                                <StatusCheckIcon className="play-problem-status-icon" />
                              ) : (
                                <StatusPlayIcon className="play-problem-status-icon" />
                              )}
                            </span>
                            <span className="play-problem-id" title={challenge.id}>
                              {trackId}
                            </span>
                            <span className="play-problem-title">{challenge.title}</span>
                            <span className="play-problem-topics">
                              <span className="play-topic-pill play-topic-pill--lab">Lab</span>
                            </span>
                            <span
                              className={`play-problem-level pill ${difficultyClass(challenge.difficulty)}`}
                            >
                              {challenge.difficulty || 'L1'}
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

  if (playState === 'library') {
    return (
      <>
        {ending && (
          <div className="lab-closing-overlay" role="status" aria-live="polite">
            <div className="lab-closing-toast">
              <span className="spinner" />
              <span>
                Closing lab
                {closingLabTitle ? <> · <strong>{closingLabTitle}</strong></> : null}
                …
              </span>
            </div>
          </div>
        )}
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
        <K8sLabWorkspace
          challenge={activeChallenge}
          session={activeSession}
          onClose={onEnd}
        />
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
