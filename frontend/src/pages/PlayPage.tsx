import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import SandboxWorkspace from '../components/SandboxWorkspace';
import SparkPlatformWorkspace, {
  isSparkPlatformChallenge,
} from '../components/SparkPlatformWorkspace';
import BoardWorkspace, { isBoardChallenge } from '../components/BoardWorkspace';
import {
  PLAY_DOMAINS,
  getPlayDomain,
  getPlayPanel,
  isPlayDomainId,
  listPlayCatalogEntries,
  looksLikePlaySessionId,
  playCatalogPath,
  type PlayDomainId,
} from '../constants/playCatalog';
import { WHITEBOARD_PATH } from '../constants/whiteboard';
import type { ChallengePublic } from '../types/domain';

type DifficultyFilter = 'all' | 'l0' | 'l1' | 'l2' | 'l3' | 'l4';

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
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('all');

  const domainId = isPlayDomainId(params.domainId) ? (params.domainId as PlayDomainId) : null;
  const domain = getPlayDomain(domainId);
  const panel = getPlayPanel(domain, params.panelId || null);

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

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalogRows
      .filter((row) => {
        if (domainId && row.domainId !== domainId) return false;
        if (activeTopicId && row.panelId !== activeTopicId) return false;
        if (!matchesDifficulty(row.challenge, difficulty)) return false;
        if (!q) return true;
        const hay = [
          catalogIdLabel(row.challenge),
          row.challenge.title,
          row.challenge.description,
          row.challenge.difficulty,
          row.panelLabel,
          row.domainLabel,
          ...(row.challenge.tags || []),
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
  }, [catalogRows, domainId, activeTopicId, difficulty, search]);

  const totalLabs = catalogRows.length;

  return (
    <div className="app-page play-problems-page play-problems-page--fixed">
      {challengesError && <div className="alert app-page-alert">{challengesError}</div>}
      {startError && <div className="alert app-page-alert">Failed to start: {startError}</div>}

      <h1 className="sr-only">Play</h1>

      <div className="play-problems-layout">
        <aside className="play-problems-sidebar" aria-label="Tracks">
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

          <div className="play-sidebar-card play-sidebar-explore">
            <div className="play-sidebar-section-label">Tracks</div>
            <nav className="play-sidebar-nav">
              <NavLink
                to="/play"
                end
                className={({ isActive }) =>
                  `play-sidebar-link${isActive && !domainId ? ' active' : ''}`
                }
              >
                <span>All labs</span>
                <span className="play-sidebar-count">{totalLabs}</span>
              </NavLink>
              {PLAY_DOMAINS.map((d) => {
                const count = d.panels.reduce((n, p) => n + p.challengeIds.length, 0);
                const empty = d.panels.length === 0;
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
          <section className="play-problems-toolbar">
            <label className="play-search">
              <span className="sr-only">Search labs</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search labs…"
              />
            </label>
            <select
              className="play-filter-select"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as DifficultyFilter)}
              aria-label="Difficulty"
            >
              <option value="all">Difficulty</option>
              <option value="l0">L0</option>
              <option value="l1">L1</option>
              <option value="l2">L2</option>
              <option value="l3">L3</option>
              <option value="l4">L4</option>
            </select>
          </section>

          <section className="play-problems-table-wrap" aria-label="Labs">
            <div className="play-problems-table-head">
              <span>Status</span>
              <span>ID</span>
              <span>Lab</span>
              <span>Topics</span>
              <span>Difficulty</span>
              <span>Submitted</span>
            </div>
            {filteredRows.length === 0 ? (
              <div className="play-problems-empty">
                {catalogRows.length === 0
                  ? 'No labs loaded from the catalog yet.'
                  : 'No labs match these filters.'}
              </div>
            ) : (
              <ul className="play-problems-table">
                {filteredRows.map(({ challenge, panelLabel, domainLabel }) => {
                  const playable = Boolean(challenge.finalized);
                  const solved = Boolean(challenge.solved);
                  return (
                    <li key={challenge.id}>
                      <button
                        type="button"
                        className={`play-problem-row${playable ? '' : ' disabled'}${solved ? ' is-solved' : ''}`}
                        disabled={!playable}
                        onClick={() => {
                          if (playable) void onSelectChallenge(challenge);
                        }}
                      >
                        <span
                          className={`play-problem-status${solved ? ' is-solved' : ''}`}
                          aria-label={solved ? 'Solved' : 'Unsolved'}
                        >
                          {solved ? '✓' : '—'}
                        </span>
                        <span
                          className="play-problem-id"
                          title={challenge.id}
                        >
                          {catalogIdLabel(challenge)}
                        </span>
                        <span className="play-problem-title">{challenge.title}</span>
                        <span className="play-problem-topics">
                          <span className="play-topic-pill">Spark</span>
                          <span className="sr-only">{domainLabel} {panelLabel}</span>
                        </span>
                        <span className={`pill ${difficultyClass(challenge.difficulty)}`}>
                          {challenge.difficulty || 'L1'}
                        </span>
                        <span
                          className="play-problem-submitters"
                          title={`${challenge.submitters || 0} users submitted`}
                        >
                          {challenge.submitters || 0}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
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
      <LibraryView
        challenges={challenges}
        challengesError={challengesError}
        startError={startError}
        onSelectChallenge={onSelectChallenge}
      />
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
