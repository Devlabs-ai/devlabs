import React, { useEffect, useState, useCallback } from 'react';

import AppPageHeader from '../components/AppPageHeader.jsx';
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

const WORKFLOW = [
  { id: 'setter', step: 1, label: 'Shape', desc: 'Agent & draft' },
  { id: 'pipeline', step: 2, label: 'Build', desc: 'Pipeline run' },
  { id: 'review', step: 3, label: 'Ship', desc: 'Review queue' },
];

function statusLabel(status) {
  if (!status || status === 'draft') return 'Draft';
  if (status === 'building') return 'Building';
  if (status === 'review_ready') return 'Ready';
  if (status === 'failed') return 'Failed';
  return status;
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

function WorkflowNav({ tab, onTab, activeDraft }) {
  return (
    <nav className="authoring-workflow" aria-label="Authoring workflow">
      {WORKFLOW.map((w, i) => (
        <React.Fragment key={w.id}>
          {i > 0 && <span className="authoring-workflow-connector" aria-hidden />}
          <button
            type="button"
            className={`authoring-step ${tab === w.id ? 'active' : ''}`}
            onClick={() => onTab(w.id)}
          >
            <span className="authoring-step-num">{w.step}</span>
            <span className="authoring-step-copy">
              <span className="authoring-step-label">{w.label}</span>
              <span className="authoring-step-desc">{w.desc}</span>
            </span>
          </button>
        </React.Fragment>
      ))}
      {activeDraft && (
        <div className="authoring-active-draft" title={activeDraft.draft?.title || 'Untitled'}>
          <span className="authoring-active-draft-label">Working on</span>
          <strong>{activeDraft.draft?.title || 'Untitled draft'}</strong>
          {activeDraft.buildStatus && (
            <span className={`pill ${activeDraft.buildStatus}`}>
              {statusLabel(activeDraft.buildStatus)}
            </span>
          )}
        </div>
      )}
    </nav>
  );
}

export default function AuthoringWorkspace({ onPromoted }) {
  const [tab, setTab] = useState('setter');
  const [drafts, setDrafts] = useState([]);
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [activeDraft, setActiveDraft] = useState(null);
  const [error, setError] = useState(null);
  const [llmConfig, setLlmConfig] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

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
      setImportOpen(false);
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
      setImportOpen(false);
      setImportText('');
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

  const llmKey = llmConfig?.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';

  return (
    <div className="authoring-studio">
      <AppPageHeader
        className="authoring-page-header"
        eyebrow="Authoring"
        title="Challenge Studio"
        lead="Shape incidents with the agent, run the build pipeline, and promote verified labs."
        aside={(
          <>
            <WorkflowNav tab={tab} onTab={setTab} activeDraft={activeDraft} />
            <div className="authoring-studio-status">
              {llmConfig?.llmConfigured ? (
                <span className="authoring-llm-pill ok">
                  <span className="dot" />
                  Agent ready
                </span>
              ) : (
                <span className="authoring-llm-pill warn" title={`Set ${llmKey} in backend/.env`}>
                  <span className="dot" />
                  Agent offline
                </span>
              )}
            </div>
          </>
        )}
      />

      {!llmConfig?.llmConfigured && (
        <div className="authoring-banner alert">
          <strong>LLM not configured.</strong> Set <code>{llmKey}</code> in{' '}
          <code>backend/.env</code> to enable chat and the AI build pipeline. You can still import
          hand-written draft JSON.
        </div>
      )}

      {error && <div className="authoring-banner alert">{error}</div>}

      <div className="authoring-studio-body">
        <aside className="authoring-rail">
          <div className="authoring-rail-head">
            <h3 className="authoring-rail-title">
              Drafts
              <span className="authoring-rail-count">{drafts.length}</span>
            </h3>
            <div className="authoring-rail-actions">
              <button type="button" className="sm" onClick={handleNewDraft}>New</button>
              <button type="button" className="ghost sm" onClick={() => setImportOpen((v) => !v)}>
                Import
              </button>
            </div>
          </div>

          {importOpen && (
            <div className="authoring-import">
              <textarea
                placeholder='{ "schemaVersion": 1, "meta": { ... }, "description": "...", ... }'
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={4}
              />
              <div className="authoring-import-actions">
                <button type="button" className="ghost sm" onClick={() => setImportOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="sm"
                  disabled={!importText.trim()}
                  onClick={() => handleImportDraft(importText)}
                >
                  Import
                </button>
              </div>
            </div>
          )}

          <div className="authoring-draft-list">
            {drafts.length === 0 ? (
              <p className="authoring-draft-empty">No drafts yet.</p>
            ) : (
              drafts.map((d) => {
                const status = d.buildStatus || 'draft';
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`authoring-draft-item ${activeDraftId === d.id ? 'active' : ''}`}
                    onClick={() => handleSelectDraft(d.id)}
                  >
                    <span className="authoring-draft-item-title">
                      <span
                        className={`authoring-draft-dot ${status}`}
                        title={statusLabel(status)}
                        aria-label={statusLabel(status)}
                      />
                      {d.draft?.title || 'Untitled draft'}
                    </span>
                    <span className="authoring-draft-item-meta dim">
                      {formatRelativeTime(d.updatedAt)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className="authoring-stage">
          <div className="authoring-stage-inner">
            {tab === 'setter' && (
              <ProblemSetterPage
                draft={activeDraft}
                llmConfig={llmConfig}
                onDraftChanged={handleDraftChanged}
                onImportDraft={handleImportDraft}
                onDeleteDraft={handleDeleteDraft}
                onGoPipeline={() => setTab('pipeline')}
                onRefreshSession={async () => {
                  if (!activeDraftId) return;
                  const fresh = await getProblemSession(activeDraftId);
                  setActiveDraft(fresh);
                }}
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
