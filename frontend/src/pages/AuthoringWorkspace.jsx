import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

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
  cancelBuild,
} from '../services/problemApi.js';

const PHASES = [
  { id: 'setter', label: 'Shape', lead: 'Chat with the agent and refine the challenge design.' },
  { id: 'pipeline', label: 'Build', lead: 'Generate assets, spin up the sandbox, and validate.' },
  { id: 'review', label: 'Ship', lead: 'Review the build and push to your library.' },
];

const DRAFT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'ready', label: 'Ready to ship' },
  { id: 'failed', label: 'Failed' },
];

const VALID_TABS = ['setter', 'pipeline', 'review'];

function statusLabel(status) {
  if (!status || status === 'draft') return 'Draft';
  if (status === 'building') return 'Building';
  if (status === 'review_ready') return 'Ready';
  if (status === 'failed') return 'Failed';
  return status;
}

function draftTitle(d) {
  return d?.draft?.meta?.name || d?.draft?.title || 'Untitled draft';
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

function matchesDraftFilter(d, filterId) {
  const status = d.buildStatus || 'draft';
  if (filterId === 'all') return true;
  if (filterId === 'in_progress') return status === 'draft' || status === 'building';
  if (filterId === 'ready') return status === 'review_ready';
  if (filterId === 'failed') return status === 'failed';
  return true;
}

function DraftLibrary({
  drafts,
  filter,
  onFilter,
  search,
  onSearch,
  onSelect,
  onNew,
  onImportOpen,
  importOpen,
  importText,
  onImportText,
  onImport,
  onImportClose,
}) {
  const counts = useMemo(() => ({
    all: drafts.length,
    in_progress: drafts.filter((d) => matchesDraftFilter(d, 'in_progress')).length,
    ready: drafts.filter((d) => matchesDraftFilter(d, 'ready')).length,
    failed: drafts.filter((d) => matchesDraftFilter(d, 'failed')).length,
  }), [drafts]);

  const filtered = useMemo(() => {
    let list = drafts.filter((d) => matchesDraftFilter(d, filter));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((d) => draftTitle(d).toLowerCase().includes(q));
    }
    return list;
  }, [drafts, filter, search]);

  return (
    <>
      <div className="library-toolbar author-toolbar">
        <div className="library-collections" role="tablist">
          {DRAFT_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`lib-tab ${filter === f.id ? 'active' : ''}`}
              onClick={() => onFilter(f.id)}
            >
              {f.label}
              <span className="lib-tab-count">{counts[f.id]}</span>
            </button>
          ))}
        </div>

        <div className="author-toolbar-actions">
          <input
            type="search"
            className="author-search"
            placeholder="Search drafts…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          <button type="button" className="sm" onClick={onNew}>New draft</button>
          <button type="button" className="ghost sm" onClick={onImportOpen}>Import</button>
        </div>
      </div>

      {importOpen && (
        <div className="author-import-panel">
          <textarea
            placeholder='{ "schemaVersion": 1, "meta": { ... }, "description": "...", ... }'
            value={importText}
            onChange={(e) => onImportText(e.target.value)}
            rows={4}
          />
          <div className="author-import-panel-actions">
            <button type="button" className="ghost sm" onClick={onImportClose}>Cancel</button>
            <button type="button" className="sm" disabled={!importText.trim()} onClick={onImport}>Import</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="author-empty">
          <p>{search.trim() ? 'No drafts match your search.' : 'No drafts in this view yet.'}</p>
          <button type="button" onClick={onNew}>Create a draft</button>
        </div>
      ) : (
        <div className="author-draft-grid">
          {filtered.map((d) => {
            const status = d.buildStatus || 'draft';
            return (
              <button
                key={d.id}
                type="button"
                className="card author-draft-card"
                onClick={() => onSelect(d.id)}
              >
                <div className="author-draft-card-top">
                  <span className={`pill ${status}`}>{statusLabel(status)}</span>
                  <span className="author-draft-card-time">{formatRelativeTime(d.updatedAt)}</span>
                </div>
                <h3>{draftTitle(d)}</h3>
                <p className="author-draft-card-desc">
                  {(d.draft?.description || d.draft?.meta?.description || 'No description yet').slice(0, 120)}
                  {(d.draft?.description || '').length > 120 ? '…' : ''}
                </p>
                <span className="author-draft-card-cta">Open →</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function AuthoringWorkspace({ onPromoted }) {
  const { draftId: urlDraftId, tab: urlTab } = useParams();
  const navigate = useNavigate();

  const [drafts, setDrafts] = useState([]);
  const [activeDraftId, setActiveDraftId] = useState(urlDraftId || null);
  const [activeDraft, setActiveDraft] = useState(null);
  const [error, setError] = useState(null);
  const [llmConfig, setLlmConfig] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [draftFilter, setDraftFilter] = useState('all');
  const [draftSearch, setDraftSearch] = useState('');

  const tab = (urlTab && VALID_TABS.includes(urlTab)) ? urlTab : 'setter';
  const inWorkspace = Boolean(urlDraftId);
  const draftLoading = Boolean(urlDraftId && !activeDraft);
  const activePhase = PHASES.find((p) => p.id === tab) || PHASES[0];
  const stuckBuilding = activeDraft?.buildStatus === 'building';

  const setTab = useCallback((t) => {
    if (activeDraftId) navigate(`/authoring/${activeDraftId}/${t}`, { replace: true });
  }, [navigate, activeDraftId]);

  const reload = useCallback(async () => {
    try {
      const list = await listProblemSessions();
      setDrafts(list);
      if (activeDraftId) {
        const fresh = await getProblemSession(activeDraftId).catch(() => null);
        if (fresh) setActiveDraft(fresh);
        else {
          setActiveDraftId(null);
          setActiveDraft(null);
          navigate('/authoring', { replace: true });
        }
      }
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    }
  }, [activeDraftId, navigate]);

  useEffect(() => {
    (async () => {
      try { setLlmConfig(await getProblemConfig()); } catch (_e) { /* noop */ }
    })();
  }, []);

  useEffect(() => { reload(); }, [reload, refreshKey]);

  useEffect(() => {
    if (!urlDraftId) {
      setActiveDraftId(null);
      setActiveDraft(null);
      return;
    }
    if (activeDraft?.id === urlDraftId) return;
    getProblemSession(urlDraftId)
      .then((d) => { setActiveDraftId(urlDraftId); setActiveDraft(d); })
      .catch(() => navigate('/authoring', { replace: true }));
  }, [urlDraftId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectDraft = async (id) => {
    setError(null);
    try {
      const d = await getProblemSession(id);
      setActiveDraftId(id);
      setActiveDraft(d);
      navigate(`/authoring/${id}/setter`, { replace: false });
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
      setImportOpen(false);
      navigate(`/authoring/${sessionId}/setter`, { replace: false });
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
      setImportOpen(false);
      setImportText('');
      navigate(`/authoring/${sessionId}/setter`, { replace: false });
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    }
  };

  const handleDeleteDraft = async (id) => {
    try {
      await deleteProblemSession(id);
      if (activeDraftId === id) {
        setActiveDraftId(null);
        setActiveDraft(null);
        navigate('/authoring', { replace: true });
      }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    }
  };

  const handleDraftChanged = (next) => {
    setActiveDraft(next);
    setDrafts((prev) => prev.map((d) => (d.id === next.id ? next : d)));
  };

  const handleCancelBuild = async () => {
    if (!activeDraftId) return;
    setCancelBusy(true);
    try {
      await cancelBuild(activeDraftId);
      const fresh = await getProblemSession(activeDraftId);
      handleDraftChanged(fresh);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setCancelBusy(false);
    }
  };

  const llmKey = llmConfig?.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';

  return (
    <div className={`authoring-studio ${inWorkspace ? 'authoring-studio--workspace' : 'authoring-studio--library'}`}>
      <AppPageHeader
        eyebrow="Author"
        title={inWorkspace && activeDraft ? draftTitle(activeDraft) : inWorkspace ? 'Loading…' : 'Your drafts'}
        lead={inWorkspace ? activePhase.lead : 'Create, build, and ship interview challenges with the agent.'}
        aside={(
          <div className="author-header-aside">
            {inWorkspace && activeDraft?.buildStatus && (
              <span className={`pill ${activeDraft.buildStatus}`}>
                {statusLabel(activeDraft.buildStatus)}
              </span>
            )}
            {llmConfig?.llmConfigured ? (
              <span className="authoring-llm-pill ok" title="LLM agent is configured">
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
        )}
        className="author-page-header"
      />

      {!llmConfig?.llmConfigured && (
        <div className="authoring-banner alert">
          <strong>LLM not configured.</strong> Set <code>{llmKey}</code> in{' '}
          <code>backend/.env</code> to enable chat and the AI build pipeline. You can still import
          hand-written draft JSON.
        </div>
      )}

      {error && <div className="authoring-banner alert">{error}</div>}

      {!inWorkspace ? (
        <DraftLibrary
          drafts={drafts}
          filter={draftFilter}
          onFilter={setDraftFilter}
          search={draftSearch}
          onSearch={setDraftSearch}
          onSelect={handleSelectDraft}
          onNew={handleNewDraft}
          onImportOpen={() => setImportOpen(true)}
          importOpen={importOpen}
          importText={importText}
          onImportText={setImportText}
          onImport={() => handleImportDraft(importText)}
          onImportClose={() => { setImportOpen(false); setImportText(''); }}
        />
      ) : draftLoading ? (
        <div className="author-empty">
          <span className="spinner" />
          <p>Loading draft…</p>
        </div>
      ) : (
        <>
          <div className="library-toolbar author-toolbar">
            <button
              type="button"
              className="ghost sm author-back-btn"
              onClick={() => navigate('/authoring')}
            >
              ← All drafts
            </button>

            <div className="library-collections" role="tablist">
              {PHASES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === p.id}
                  className={`lib-tab ${tab === p.id ? 'active' : ''}`}
                  onClick={() => setTab(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="author-toolbar-actions">
              {stuckBuilding && (
                <button
                  type="button"
                  className="ghost sm danger"
                  onClick={handleCancelBuild}
                  disabled={cancelBusy}
                >
                  {cancelBusy ? 'Cancelling…' : 'Cancel build'}
                </button>
              )}
            </div>
          </div>

          <main className="authoring-stage authoring-stage--solo">
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
                    setActiveDraftId(null);
                    setActiveDraft(null);
                    setRefreshKey((k) => k + 1);
                    navigate('/authoring', { replace: true });
                    if (onPromoted) onPromoted(slug);
                  }}
                  refreshKey={refreshKey}
                />
              )}
            </div>
          </main>
        </>
      )}
    </div>
  );
}
