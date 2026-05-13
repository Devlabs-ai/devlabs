import React, { useEffect, useState, useCallback } from 'react';

import ProblemSetterPage from './ProblemSetterPage.jsx';
import PipelinePage from './PipelinePage.jsx';
import ReviewPage from './ReviewPage.jsx';

import {
  listProblemSessions,
  createProblemSession,
  importDraft as apiImportDraft,
  getProblemSession,
  deleteProblemSession,
  getProblemConfig,
} from '../services/problemApi.js';

const TABS = [
  { id: 'setter',   label: 'Problem Setter', icon: '✎' },
  { id: 'pipeline', label: 'Pipeline',       icon: '⚙' },
  { id: 'review',   label: 'Review Queue',   icon: '✓' },
];

export default function AuthoringWorkspace({ onPromoted }) {
  const [tab, setTab] = useState('setter');
  const [drafts, setDrafts] = useState([]);
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [activeDraft, setActiveDraft] = useState(null);
  const [error, setError] = useState(null);
  const [llmConfig, setLlmConfig] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = useCallback(async () => {
    try {
      const list = await listProblemSessions();
      setDrafts(list);
      if (activeDraftId) {
        const fresh = await getProblemSession(activeDraftId).catch(() => null);
        if (fresh) setActiveDraft(fresh);
        else { setActiveDraftId(null); setActiveDraft(null); }
      }
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    }
  }, [activeDraftId]);

  useEffect(() => {
    (async () => {
      try { setLlmConfig(await getProblemConfig()); } catch (_e) { /* noop */ }
    })();
  }, []);

  useEffect(() => { reload(); }, [reload, refreshKey]);

  const handleSelectDraft = async (id) => {
    setActiveDraftId(id);
    setError(null);
    try {
      const d = await getProblemSession(id);
      setActiveDraft(d);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    }
  };

  const handleNewDraft = async () => {
    try {
      const { sessionId, draft } = await createProblemSession();
      setActiveDraftId(sessionId);
      setActiveDraft(draft);
      setRefreshKey((k) => k + 1);
      setTab('setter');
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    }
  };

  const handleImportDraft = async (json) => {
    try {
      const parsed = typeof json === 'string' ? JSON.parse(json) : json;
      const { sessionId, draft } = await apiImportDraft(parsed);
      setActiveDraftId(sessionId);
      setActiveDraft(draft);
      setRefreshKey((k) => k + 1);
      setTab('setter');
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    }
  };

  const handleDeleteDraft = async (id) => {
    try {
      await deleteProblemSession(id);
      if (activeDraftId === id) { setActiveDraftId(null); setActiveDraft(null); }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    }
  };

  const handleDraftChanged = (next) => {
    setActiveDraft(next);
    setDrafts((prev) => prev.map((d) => (d.id === next.id ? next : d)));
  };

  return (
    <div className="authoring">
      {!llmConfig?.llmConfigured && (
        <div className="alert">
          <strong>LLM not configured.</strong> Set{' '}
          <code>{llmConfig?.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'}</code> in
          {' '}<code>backend/.env</code> to enable the chat agent and AI build pipeline
          (current provider: <code>{llmConfig?.provider || 'anthropic'}</code>).
          Without it, you can still import a hand-written draft as JSON.
        </div>
      )}
      {error && <div className="alert" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="authoring-shell">
        <aside className="authoring-sidebar">
          <div className="sidebar-header">
            <h3>Drafts</h3>
            <button className="ghost sm" onClick={handleNewDraft}>+ New</button>
          </div>
          <div className="draft-list">
            {drafts.length === 0 && (
              <div className="empty">No drafts yet. Start a new one or import JSON.</div>
            )}
            {drafts.map((d) => (
              <button
                key={d.id}
                className={`draft-item ${activeDraftId === d.id ? 'active' : ''}`}
                onClick={() => handleSelectDraft(d.id)}
              >
                <div className="title">{d.draft?.title || 'Untitled draft'}</div>
                <div className="meta">
                  {d.buildStatus
                    ? <span className={`pill ${d.buildStatus}`}>{d.buildStatus}</span>
                    : <span className="pill draft">draft</span>}
                  <span className="dim">{new Date(d.updatedAt).toLocaleString()}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="authoring-main">
          <div className="authoring-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`authoring-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className="icon">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          <div className="authoring-tabpane">
            {tab === 'setter' && (
              <ProblemSetterPage
                draft={activeDraft}
                llmConfig={llmConfig}
                onDraftChanged={handleDraftChanged}
                onImportDraft={handleImportDraft}
                onDeleteDraft={handleDeleteDraft}
                onGoPipeline={() => setTab('pipeline')}
              />
            )}
            {tab === 'pipeline' && (
              <PipelinePage
                draft={activeDraft}
                llmConfig={llmConfig}
                onDraftChanged={handleDraftChanged}
                onGoReview={() => { setTab('review'); setRefreshKey((k) => k + 1); }}
              />
            )}
            {tab === 'review' && (
              <ReviewPage
                onPromoted={(slug) => {
                  setRefreshKey((k) => k + 1);
                  if (onPromoted) onPromoted(slug);
                }}
                refreshKey={refreshKey}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
