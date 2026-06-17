import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { markdownExcerpt } from '../utils/markdownText';

import ProblemSetterPage from './ProblemSetterPage';
import PipelinePage from './PipelinePage';
import {
  listProblemSessions,
  createProblemSession,
  importDraft as apiImportDraft,
  getProblemSession,
  deleteProblemSession,
  getProblemConfig,
  cancelBuild,
} from '../services/problemApi';
import type { ProblemSession } from '../types/domain';

interface DraftFilter {
  id: string;
  label: string;
}

const DRAFT_FILTERS: DraftFilter[] = [
  { id: 'all',        label: 'All' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'ready',      label: 'Ready to ship' },
  { id: 'changes',    label: 'Needs changes' },
  { id: 'failed',     label: 'Failed' },
];

const VALID_TABS: string[] = ['setter', 'pipeline'];

function statusLabel(status: string | null | undefined): string {
  if (!status || status === 'draft') return 'Draft';
  if (status === 'building') return 'Building';
  if (status === 'review_ready') return 'Ready';
  if (status === 'changes_requested') return 'Needs changes';
  if (status === 'failed') return 'Failed';
  return status;
}

function draftTitle(d: ProblemSession | null | undefined): string {
  return d?.draft?.meta?.name ?? d?.draft?.title ?? 'Untitled draft';
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

function matchesDraftFilter(d: ProblemSession, filterId: string): boolean {
  const status = d.buildStatus || 'draft';
  if (filterId === 'all') return true;
  if (filterId === 'in_progress') return status === 'draft' || status === 'building';
  if (filterId === 'ready') return status === 'review_ready';
  if (filterId === 'changes') return status === 'changes_requested';
  if (filterId === 'failed') return status === 'failed';
  return true;
}

interface DraftLibraryProps {
  drafts: ProblemSession[];
  filter: string;
  onFilter: (id: string) => void;
  search: string;
  onSearch: (q: string) => void;
  onSelect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onNew: () => Promise<void>;
  onImportOpen: () => void;
  importOpen: boolean;
  importText: string;
  onImportText: (text: string) => void;
  onImport: () => Promise<void>;
  onImportClose: () => void;
  toolbarExtra?: React.ReactNode;
}

function DraftLibrary({
  drafts,
  filter,
  onFilter,
  search,
  onSearch,
  onSelect,
  onDelete,
  onNew,
  onImportOpen,
  importOpen,
  importText,
  onImportText,
  onImport,
  onImportClose,
  toolbarExtra,
}: DraftLibraryProps): JSX.Element {
  const counts = useMemo<Record<string, number>>(() => ({
    all:         drafts.length,
    in_progress: drafts.filter((d) => matchesDraftFilter(d, 'in_progress')).length,
    ready:       drafts.filter((d) => matchesDraftFilter(d, 'ready')).length,
    changes:     drafts.filter((d) => matchesDraftFilter(d, 'changes')).length,
    failed:      drafts.filter((d) => matchesDraftFilter(d, 'failed')).length,
  }), [drafts]);

  const filtered = useMemo<ProblemSession[]>(() => {
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
          {toolbarExtra}
          <input
            type="search"
            className="author-search"
            placeholder="Search drafts…"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearch(e.target.value)}
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
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onImportText(e.target.value)}
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
            const title = draftTitle(d);
            return (
              <article key={d.id} className="card author-draft-card">
                <div className="author-draft-card-top">
                  <span className={`pill ${status}`}>{statusLabel(status)}</span>
                  <span className="author-draft-card-time">{formatRelativeTime(d.updatedAt)}</span>
                </div>
                <h3>{title}</h3>
                <p className="author-draft-card-desc">
                  {markdownExcerpt(
                    d.draft?.description || d.draft?.meta?.description || '',
                    { maxLen: 140, title },
                  )}
                </p>
                <div className="author-draft-card-actions">
                  <button
                    type="button"
                    className="author-draft-card-cta"
                    onClick={() => onSelect(d.id)}
                  >
                    Open →
                  </button>
                  <button
                    type="button"
                    className="author-draft-card-cta author-draft-card-cta--danger"
                    onClick={() => {
                      if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
                      onDelete(d.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

interface LlmConfig {
  llmConfigured: boolean;
  maxIterations?: number;
  provider?: string;
}

interface AuthoringWorkspaceProps {
  onPromoted: () => Promise<void>;
}

export default function AuthoringWorkspace({ onPromoted: _onPromoted }: AuthoringWorkspaceProps): JSX.Element {
  const { draftId: urlDraftId, tab: urlTab } = useParams<{ draftId?: string; tab?: string }>();
  const navigate = useNavigate();

  const [drafts, setDrafts] = useState<ProblemSession[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(urlDraftId ?? null);
  const [activeDraft, setActiveDraft] = useState<ProblemSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [llmConfig, setLlmConfig] = useState<LlmConfig | null>(null);
  const [llmConfigReady, setLlmConfigReady] = useState<boolean>(false);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [importOpen, setImportOpen] = useState<boolean>(false);
  const [importText, setImportText] = useState<string>('');
  const [cancelBusy, setCancelBusy] = useState<boolean>(false);
  const [draftFilter, setDraftFilter] = useState<string>('all');
  const [draftSearch, setDraftSearch] = useState<string>('');

  const tab = (urlTab && VALID_TABS.includes(urlTab)) ? urlTab : 'setter';
  const inWorkspace = Boolean(urlDraftId);
  const draftLoading = Boolean(urlDraftId && !activeDraft);
  const stuckBuilding = activeDraft?.buildStatus === 'building';

  const setTab = useCallback((t: string): void => {
    if (activeDraftId) navigate(`/authoring/${activeDraftId}/${t}`, { replace: true });
  }, [navigate, activeDraftId]);

  const goPipelineLogs = useCallback((attempt: number | null = null): void => {
    if (!activeDraftId) return;
    navigate(`/authoring/${activeDraftId}/pipeline`, {
      state: attempt != null ? { focusAttempt: attempt } : undefined,
    });
  }, [activeDraftId, navigate]);

  const goReview = useCallback((sessionId: string | null = null): void => {
    navigate('/review', {
      state: sessionId ? { sessionId } : undefined,
    });
  }, [navigate]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const list = await listProblemSessions() as ProblemSession[];
      setDrafts(list);
      if (activeDraftId) {
        const fresh = await getProblemSession(activeDraftId).catch((): null => null) as ProblemSession | null;
        if (fresh) setActiveDraft(fresh);
        else {
          setActiveDraftId(null);
          setActiveDraft(null);
          navigate('/authoring', { replace: true });
        }
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error ?? err.message ?? 'Unknown error');
    }
  }, [activeDraftId, navigate]);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const cfg = await getProblemConfig() as LlmConfig;
        if (!cancelled) setLlmConfig(cfg);
      } catch (_e) { /* noop */ }
      finally {
        if (!cancelled) setLlmConfigReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { reload(); }, [reload, refreshKey]);

  useEffect(() => {
    if (urlTab === 'review') {
      navigate('/review', {
        replace: true,
        state: urlDraftId ? { sessionId: urlDraftId } : undefined,
      });
      return;
    }
    if (urlDraftId && (!urlTab || !VALID_TABS.includes(urlTab))) {
      navigate(`/authoring/${urlDraftId}/setter`, { replace: true });
    }
  }, [urlDraftId, urlTab, navigate]);

  useEffect(() => {
    if (!urlDraftId) {
      setActiveDraftId(null);
      setActiveDraft(null);
      return;
    }
    if (activeDraft?.id === urlDraftId) return;
    getProblemSession(urlDraftId)
      .then((d) => { setActiveDraftId(urlDraftId); setActiveDraft(d as ProblemSession); })
      .catch(() => navigate('/authoring', { replace: true }));
  }, [urlDraftId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectDraft = async (id: string): Promise<void> => {
    setError(null);
    try {
      const d = await getProblemSession(id) as ProblemSession;
      setActiveDraftId(id);
      setActiveDraft(d);
      navigate(`/authoring/${id}/setter`, { replace: false });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error ?? err.message ?? 'Unknown error');
    }
  };

  const handleNewDraft = async (): Promise<void> => {
    try {
      const result = await createProblemSession() as { sessionId: string; draft: ProblemSession };
      const { sessionId, draft } = result;
      setActiveDraftId(sessionId);
      setActiveDraft(draft);
      setRefreshKey((k) => k + 1);
      setImportOpen(false);
      navigate(`/authoring/${sessionId}/setter`, { replace: false });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error ?? err.message ?? 'Unknown error');
    }
  };

  const handleImportDraft = async (json: string | object): Promise<void> => {
    try {
      const parsed = typeof json === 'string' ? JSON.parse(json) : json;
      const result = await apiImportDraft(parsed) as { sessionId: string; draft: ProblemSession };
      const { sessionId, draft } = result;
      setActiveDraftId(sessionId);
      setActiveDraft(draft);
      setRefreshKey((k) => k + 1);
      setImportOpen(false);
      setImportText('');
      navigate(`/authoring/${sessionId}/setter`, { replace: false });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error ?? err.message ?? 'Unknown error');
    }
  };

  const handleDeleteDraft = async (id: string): Promise<void> => {
    try {
      await deleteProblemSession(id);
      if (activeDraftId === id) {
        setActiveDraftId(null);
        setActiveDraft(null);
        navigate('/authoring', { replace: true });
      }
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error ?? err.message ?? 'Unknown error');
    }
  };

  const handleDraftChanged = (next: ProblemSession): void => {
    setActiveDraft(next);
    setDrafts((prev) => prev.map((d) => (d.id === next.id ? next : d)));
  };

  const handleCancelBuild = async (): Promise<void> => {
    if (!activeDraftId) return;
    setCancelBusy(true);
    try {
      await cancelBuild(activeDraftId);
      const fresh = await getProblemSession(activeDraftId) as ProblemSession;
      handleDraftChanged(fresh);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error ?? err.message ?? 'Unknown error');
    } finally {
      setCancelBusy(false);
    }
  };

  const llmKey = llmConfig?.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';

  const llmBanner = llmConfigReady && !llmConfig?.llmConfigured && (
    <div className="authoring-banner alert">
      <strong>LLM not configured.</strong> Set <code>{llmKey}</code> in{' '}
      <code>backend/.env</code> to enable chat and the AI build pipeline. You can still import
      hand-written draft JSON.
    </div>
  );

  return (
    <div className={`authoring-studio ${inWorkspace ? 'authoring-studio--workspace' : 'authoring-studio--library'}`}>
      {!inWorkspace && llmBanner}
      {!inWorkspace && error && <div className="authoring-banner alert">{error}</div>}

      {!inWorkspace ? (
        <DraftLibrary
          drafts={drafts}
          filter={draftFilter}
          onFilter={setDraftFilter}
          search={draftSearch}
          onSearch={setDraftSearch}
          onSelect={handleSelectDraft}
          onDelete={handleDeleteDraft}
          onNew={handleNewDraft}
          onImportOpen={() => setImportOpen(true)}
          importOpen={importOpen}
          importText={importText}
          onImportText={setImportText}
          onImport={() => handleImportDraft(importText)}
          onImportClose={() => { setImportOpen(false); setImportText(''); }}
          toolbarExtra={(
            !llmConfigReady ? (
              <span className="authoring-llm-pill dim" title="Checking LLM configuration">
                <span className="dot" />
                Agent…
              </span>
            ) : llmConfig?.llmConfigured ? (
              <span className="authoring-llm-pill ok" title="LLM agent is configured">
                <span className="dot" />
                Agent ready
              </span>
            ) : (
              <span className="authoring-llm-pill warn" title={`Set ${llmKey} in backend/.env`}>
                <span className="dot" />
                Agent offline
              </span>
            )
          )}
        />
      ) : draftLoading ? (
        <div className="author-empty">
          <span className="spinner" />
          <p>Loading draft…</p>
        </div>
      ) : (
        <>
          {llmBanner}
          {error && <div className="authoring-banner alert authoring-banner--compact">{error}</div>}

          <main className="authoring-stage authoring-stage--solo">
            <div className="authoring-stage-inner">
              {tab === 'setter' && (
                <ProblemSetterPage
                  draft={activeDraft}
                  llmConfig={llmConfig}
                  onGoPipelineLogs={goPipelineLogs}
                  onGoBuild={() => setTab('pipeline')}
                  onGoReview={() => goReview(activeDraftId)}
                  onDraftChanged={handleDraftChanged}
                  onImportDraft={handleImportDraft}
                  onDeleteDraft={handleDeleteDraft}
                  onRefreshSession={async (): Promise<void> => {
                    if (!activeDraftId) return;
                    const fresh = await getProblemSession(activeDraftId) as ProblemSession;
                    setActiveDraft(fresh);
                  }}
                />
              )}
              {tab === 'pipeline' && (
                <PipelinePage
                  draft={activeDraft}
                  llmConfig={llmConfig}
                  onDraftChanged={handleDraftChanged}
                  onGoReview={() => goReview(activeDraftId)}
                  onCancelBuild={stuckBuilding ? handleCancelBuild : undefined}
                  cancelBuildBusy={cancelBusy}
                />
              )}
            </div>
          </main>
        </>
      )}
    </div>
  );
}
