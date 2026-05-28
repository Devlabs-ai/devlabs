import React, { useMemo, useState } from 'react';
import { useAppState } from '../context/AppStateContext.jsx';
import AppPageHeader from '../components/AppPageHeader.jsx';
import ChallengeLibrary from '../components/ChallengeLibrary.jsx';
import ProblemStatement from '../components/ProblemStatement.jsx';
import TerminalWorkspace from '../components/TerminalWorkspace.jsx';
import CodeEditor from '../components/CodeEditor.jsx';
import { BUCKETS, UNBUCKETED } from '../constants/buckets.js';

const ALL_FILTER = '__all__';

function groupByBucket(challenges) {
  const groups = new Map();
  for (const b of BUCKETS) groups.set(b.id, []);
  groups.set(UNBUCKETED.id, []);
  for (const c of challenges) {
    const key = c.bucket && groups.has(c.bucket) ? c.bucket : UNBUCKETED.id;
    groups.get(key).push(c);
  }
  return groups;
}

function LibraryView({ challenges, challengesError, startError, onSelectChallenge }) {
  const [filter, setFilter] = useState(ALL_FILTER);

  const groups = useMemo(() => groupByBucket(challenges), [challenges]);

  const visibleSections = useMemo(() => {
    const ordered = [
      ...BUCKETS.map((b) => ({ id: b.id, label: b.label, items: groups.get(b.id) || [] })),
      { id: UNBUCKETED.id, label: UNBUCKETED.label, items: groups.get(UNBUCKETED.id) || [] },
    ].filter((s) => s.items.length > 0);
    if (filter === ALL_FILTER) return ordered;
    return ordered.filter((s) => s.id === filter);
  }, [groups, filter]);

  return (
    <div className="app-page">
      {challengesError && <div className="alert app-page-alert">{challengesError}</div>}
      {startError && <div className="alert app-page-alert">Failed to start: {startError}</div>}
      <AppPageHeader
        eyebrow="Play"
        title="Challenge Library"
        meta={`${challenges.length} ${challenges.length === 1 ? 'challenge' : 'challenges'} available`}
        lead="Pick a curated lab and spin up a live Docker sandbox for your next interview."
      />

      <div className="bucket-filter-bar" role="tablist" aria-label="Filter by role bucket">
        <button
          type="button"
          role="tab"
          aria-selected={filter === ALL_FILTER}
          className={`bucket-chip ${filter === ALL_FILTER ? 'active' : ''}`}
          onClick={() => setFilter(ALL_FILTER)}
        >
          All <span className="count">{challenges.length}</span>
        </button>
        {BUCKETS.map((b) => {
          const count = (groups.get(b.id) || []).length;
          if (count === 0) return null;
          return (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={filter === b.id}
              className={`bucket-chip ${filter === b.id ? 'active' : ''}`}
              onClick={() => setFilter(b.id)}
            >
              {b.label} <span className="count">{count}</span>
            </button>
          );
        })}
        {(groups.get(UNBUCKETED.id) || []).length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={filter === UNBUCKETED.id}
            className={`bucket-chip ${filter === UNBUCKETED.id ? 'active' : ''}`}
            onClick={() => setFilter(UNBUCKETED.id)}
          >
            {UNBUCKETED.label} <span className="count">{(groups.get(UNBUCKETED.id) || []).length}</span>
          </button>
        )}
      </div>

      {visibleSections.length === 0 ? (
        <ChallengeLibrary challenges={[]} onSelect={onSelectChallenge} />
      ) : (
        visibleSections.map((section) => (
          <section key={section.id} className="bucket-section" data-bucket={section.id}>
            <header className="bucket-section-header">
              <div className="bucket-section-title">
                <span className="bucket-section-dot" aria-hidden />
                <h2>{section.label}</h2>
              </div>
              <span className="bucket-section-count">
                {section.items.length} {section.items.length === 1 ? 'challenge' : 'challenges'}
              </span>
            </header>
            <ChallengeLibrary challenges={section.items} onSelect={onSelectChallenge} />
          </section>
        ))
      )}
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
