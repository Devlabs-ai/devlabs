import React, { useMemo, useState } from 'react';
import { useAppState } from '../context/AppStateContext.jsx';
import AppPageHeader from '../components/AppPageHeader.jsx';
import ChallengeLibrary from '../components/ChallengeLibrary.jsx';
import ProblemStatement from '../components/ProblemStatement.jsx';
import TerminalWorkspace from '../components/TerminalWorkspace.jsx';
import CodeEditor from '../components/CodeEditor.jsx';
import BrowserTab from '../components/BrowserTab.jsx';

const COLLECTIONS = [
  { id: 'my',     label: 'My Challenges' },
  { id: 'org',    label: 'Org Challenges' },
  { id: 'public', label: 'Public Challenges' },
];

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

const DOMAINS = [
  { id: 'software-engineer', label: 'Software Eng' },
  { id: 'platform-engineer', label: 'Platform' },
  { id: 'devops',            label: 'DevOps' },
  { id: 'data-engineer',     label: 'Data Eng' },
];

function LibraryView({ challenges, challengesError, startError, onSelectChallenge }) {
  const { currentUser } = useAppState();

  const [collection, setCollection] = useState('public');
  const [difficulty, setDifficulty] = useState(null);
  const [domain, setDomain]         = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = React.useRef(null);

  // Close popover on outside click
  React.useEffect(() => {
    if (!filterOpen) return undefined;
    const handler = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [filterOpen]);

  const activeFilterCount = (difficulty ? 1 : 0) + (domain ? 1 : 0);

  const collectionCounts = useMemo(() => ({
    my:     challenges.filter((c) => c.authored_by && c.authored_by === currentUser?.id).length,
    org:    challenges.filter((c) => c.authored_by && c.authored_by !== currentUser?.id).length,
    public: challenges.filter((c) => !c.authored_by || c.visibility === 'public').length,
  }), [challenges, currentUser]);

  const filtered = useMemo(() => {
    let list = challenges;

    // Collection tab
    if (collection === 'my') {
      list = list.filter((c) => c.authored_by && c.authored_by === currentUser?.id);
    } else if (collection === 'org') {
      list = list.filter((c) => c.authored_by && c.authored_by !== currentUser?.id);
    } else {
      list = list.filter((c) => !c.authored_by || c.visibility === 'public');
    }

    // Difficulty
    if (difficulty) {
      list = list.filter((c) => (c.difficulty || '').toLowerCase() === difficulty.toLowerCase());
    }

    // Domain
    if (domain) {
      list = list.filter((c) => c.bucket === domain);
    }

    return list;
  }, [challenges, collection, difficulty, domain, currentUser]);

  return (
    <div className="app-page">
      {challengesError && <div className="alert app-page-alert">{challengesError}</div>}
      {startError && <div className="alert app-page-alert">Failed to start: {startError}</div>}

      <AppPageHeader
        eyebrow="Play"
        title="Challenge Library"
        meta={`${filtered.length} ${filtered.length === 1 ? 'challenge' : 'challenges'}`}
        lead="Pick a curated lab and spin up a live Docker sandbox for your next interview."
      />

      {/* Collection tabs + filters row */}
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

      <ChallengeLibrary challenges={filtered} onSelect={onSelectChallenge} />
    </div>
  );
}

export default function PlayPage() {
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

  const [rightTab, setRightTab] = useState('terminal');

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
      <div className="workspace workspace-2col">
        <div className="col">
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-header">
              <div className="title">
                <span className="icon">◆</span> Inc Brief
              </div>
              {activeChallenge?.difficulty && (
                <span className="meta">{activeChallenge.difficulty}</span>
              )}
            </div>
            <div className="panel-body">
              <ProblemStatement challenge={activeChallenge} />
            </div>
          </div>
        </div>

        <div className="col col-main">
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-header">
              <div className="panel-tabs">
                <button
                  type="button"
                  className={`panel-tab ${rightTab === 'terminal' ? 'active' : ''}`}
                  onClick={() => setRightTab('terminal')}
                >
                  <span className="term-dots"><span /><span /><span /></span>
                  Terminal
                </button>
                <button
                  type="button"
                  className={`panel-tab ${rightTab === 'editor' ? 'active' : ''}`}
                  onClick={() => setRightTab('editor')}
                >
                  <span className="icon">&#9632;</span> Editor
                </button>
                <button
                  type="button"
                  className={`panel-tab ${rightTab === 'browser' ? 'active' : ''}`}
                  onClick={() => setRightTab('browser')}
                >
                  <span className="icon">⬡</span> Browser
                </button>
              </div>
              <span className="meta">
                {(activeSession.services || []).length}{' '}
                {(activeSession.services || []).length === 1 ? 'container' : 'containers'} ·{' '}
                <span title={activeSession.id} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {activeSession.id.slice(0, 8)}
                </span>
              </span>
            </div>
            <div className="panel-body flush">
              {/* Terminal stays mounted to keep WebSocket alive */}
              <div style={{ display: rightTab === 'terminal' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <TerminalWorkspace
                  services={activeSession.services}
                  baseWsUrl={activeSession.terminalWsUrl}
                  defaultService={activeSession.terminalService}
                />
              </div>
              <div style={{ display: rightTab === 'editor' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <CodeEditor
                  sessionId={activeSession.id}
                  services={activeSession.services}
                  defaultContainer={activeSession.terminalService}
                />
              </div>
              <div style={{ display: rightTab === 'browser' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <BrowserTab />
              </div>
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
