import React, { useMemo, useState } from 'react';
import { useAppState } from '../context/AppStateContext';
import ChallengeLibrary from '../components/ChallengeLibrary';
import ShareEvalModal from '../components/ShareEvalModal';
import SandboxWorkspace from '../components/SandboxWorkspace';
import type { ChallengePublic } from '../types/domain';

interface Collection {
  id: string;
  label: string;
}

const COLLECTIONS: Collection[] = [
  { id: 'my',      label: 'My Challenges' },
  { id: 'org',     label: 'Org Challenges' },
  { id: 'public',  label: 'Public Challenges' },
  { id: 'archive', label: 'Archive' },
];

const DIFFICULTIES: string[] = ['Easy', 'Medium', 'Hard'];

interface DomainFilter {
  id: string;
  label: string;
}

const DOMAINS: DomainFilter[] = [
  { id: 'software-engineer', label: 'Software Eng' },
  { id: 'platform-engineer', label: 'Platform' },
  { id: 'devops',            label: 'DevOps' },
  { id: 'data-engineer',     label: 'Data Eng' },
];

interface LibraryViewProps {
  challenges: ChallengePublic[];
  challengesError: string | null;
  startError: string | null;
  onSelectChallenge: (challenge: ChallengePublic) => void | Promise<void>;
}

function LibraryView({ challenges, challengesError, startError, onSelectChallenge }: LibraryViewProps): JSX.Element {
  const { currentUser } = useAppState();

  const [collection, setCollection] = useState<string>('my');
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const [domain, setDomain]         = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState<boolean>(false);
  const [shareChallenge, setShareChallenge] = useState<ChallengePublic | null>(null);
  const filterRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!filterOpen) return undefined;
    const handler = (e: PointerEvent): void => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [filterOpen]);

  const activeFilterCount = (difficulty ? 1 : 0) + (domain ? 1 : 0);

  const activeChallenges = useMemo(
    () => challenges.filter((c) => !c.archived),
    [challenges],
  );
  const archivedChallenges = useMemo(
    () => challenges.filter((c) => c.archived),
    [challenges],
  );

  const collectionCounts = useMemo<Record<string, number>>(() => ({
    my:      activeChallenges.filter((c) => c.authored_by && c.authored_by === currentUser?.id).length,
    org:     activeChallenges.filter((c) => c.authored_by && c.authored_by !== currentUser?.id).length,
    public:  activeChallenges.filter((c) => !c.authored_by || c.visibility === 'public').length,
    archive: archivedChallenges.length,
  }), [activeChallenges, archivedChallenges, currentUser]);

  const filtered = useMemo<ChallengePublic[]>(() => {
    let list = collection === 'archive' ? archivedChallenges : activeChallenges;

    if (collection === 'my') {
      list = list.filter((c) => c.authored_by && c.authored_by === currentUser?.id);
    } else if (collection === 'org') {
      list = list.filter((c) => c.authored_by && c.authored_by !== currentUser?.id);
    } else if (collection === 'public') {
      list = list.filter((c) => !c.authored_by || c.visibility === 'public');
    }

    if (difficulty) {
      list = list.filter((c) => (c.difficulty || '').toLowerCase() === difficulty.toLowerCase());
    }

    if (domain) {
      list = list.filter((c) => c.bucket === domain);
    }

    return list;
  }, [activeChallenges, archivedChallenges, collection, difficulty, domain, currentUser]);

  return (
    <div className="app-page">
      {challengesError && <div className="alert app-page-alert">{challengesError}</div>}
      {startError && <div className="alert app-page-alert">Failed to start: {startError}</div>}

      <div className="library-toolbar">
        <div className="library-collections" role="tablist">
          {COLLECTIONS.map((col) => (
            <button
              key={col.id}
              type="button"
              role="tab"
              aria-selected={collection === col.id}
              className={`lib-tab ${collection === col.id ? 'active' : ''}`}
              onClick={() => setCollection(col.id)}
            >
              {col.label}
              <span className="lib-tab-count">{collectionCounts[col.id]}</span>
            </button>
          ))}
        </div>

        <div className="filter-popover-wrap" ref={filterRef}>
          <button
            type="button"
            className={`filter-funnel-btn ${filterOpen ? 'open' : ''} ${activeFilterCount > 0 ? 'has-filters' : ''}`}
            onClick={() => setFilterOpen((o) => !o)}
            aria-label="Filters"
          >
            <svg className="funnel-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1.5 3h13L9.5 8.5V13l-3-1.5V8.5L1.5 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            </svg>
            {activeFilterCount > 0 && (
              <span className="filter-funnel-badge">{activeFilterCount}</span>
            )}
          </button>

          {filterOpen && (
            <div className="filter-popover">
              <div className="filter-popover-section">
                <span className="filter-popover-label">Difficulty</span>
                <div className="filter-group">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`filter-chip difficulty-${d.toLowerCase()} ${difficulty === d ? 'active' : ''}`}
                      onClick={() => setDifficulty((prev) => (prev === d ? null : d))}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="filter-popover-section">
                <span className="filter-popover-label">Domain</span>
                <div className="filter-group filter-group--wrap">
                  {DOMAINS.map((dom) => (
                    <button
                      key={dom.id}
                      type="button"
                      className={`filter-chip ${domain === dom.id ? 'active' : ''}`}
                      onClick={() => setDomain((prev) => (prev === dom.id ? null : dom.id))}
                    >
                      {dom.label}
                    </button>
                  ))}
                </div>
              </div>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  className="filter-clear"
                  onClick={() => { setDifficulty(null); setDomain(null); }}
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <ChallengeLibrary
        challenges={filtered}
        onSelect={onSelectChallenge}
        showCardMenu={collection === 'my'}
        onShareChallenge={(c) => setShareChallenge(c)}
        archiveMode={collection === 'archive'}
      />

      <ShareEvalModal
        open={Boolean(shareChallenge)}
        challenge={shareChallenge}
        onClose={() => setShareChallenge(null)}
      />
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
  } = useAppState();

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
      <SandboxWorkspace
        mode="play"
        challenge={activeChallenge}
        session={activeSession}
      />
    );
  }

  if (playState === 'ended' && endResult) {
    const result = endResult as { elapsed?: number };
    return (
      <div className="app-page app-page-centered">
        <div className="score-card app-surface-card">
          <h2>Session ended</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 8px' }}>
            Elapsed: {Math.floor((result.elapsed ?? 0) / 1000)}s
          </p>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 20px' }}>
            The sandbox has been torn down. Evaluate the candidate from your notes.
          </p>
          <button type="button" onClick={onBackToLibrary}>
            Back to library
          </button>
        </div>
      </div>
    );
  }

  return null;
}
