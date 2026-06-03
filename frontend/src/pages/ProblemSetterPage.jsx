import React, { useEffect, useRef, useState } from 'react';
import MarkdownProse from '../components/MarkdownProse.jsx';
import { ChecklistPhaseTracker, PhaseTracker } from '../components/PhaseTracker.jsx';
import { DesignValidationChecklist } from '../components/ValidationChecklist.jsx';
import {
  streamChat,
  approveDesign,
  reviseDesign,
  generateSchema,
} from '../services/problemApi.js';

function Empty({ onImport }) {
  const [text, setText] = useState('');
  const [showImport, setShowImport] = useState(false);
  return (
    <div className="authoring-empty setter-empty">
      <div className="authoring-empty-icon" aria-hidden>✎</div>
      <div className="authoring-empty-copy">
        <h2>Shape your challenge</h2>
        <p>Select a draft from the library, create a new one, or import JSON to get started.</p>
      </div>
      {showImport ? (
        <div className="import-box">
          <textarea
            placeholder='{ "schemaVersion": 1, "meta": { ... }, "description": "...", ... }'
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setShowImport(false)}>Cancel</button>
            <button type="button" onClick={() => onImport(text)} disabled={!text.trim()}>Import draft</button>
          </div>
        </div>
      ) : (
        <button type="button" className="ghost" onClick={() => setShowImport(true)}>Import draft JSON…</button>
      )}
    </div>
  );
}

function ChatBubble({ role, content }) {
  return (
    <div className={`chat-bubble ${role}`}>
      <div className="role">{role}</div>
      <div className="content">{content}</div>
    </div>
  );
}

const PIPELINE_HISTORY_PAGE_SIZE = 10;

function PipelineHistoryRail({ draft, onGoPipelineLogs }) {
  const [page, setPage] = useState(0);
  const status = draft?.buildStatus || 'draft';
  const checklists = [...(draft?.buildChecklists || [])].reverse();
  const attempts = draft?.buildAttempts || 0;
  const maxAttempts = draft?.buildLatestChecklist?.total || checklists[0]?.total || 5;
  const hasRuns = status !== 'draft' || checklists.length > 0;
  const isBuilding = status === 'building';

  useEffect(() => {
    setPage(0);
  }, [draft?.id]);

  const totalPages = Math.max(1, Math.ceil(checklists.length / PIPELINE_HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageChecklists = checklists.slice(
    safePage * PIPELINE_HISTORY_PAGE_SIZE,
    safePage * PIPELINE_HISTORY_PAGE_SIZE + PIPELINE_HISTORY_PAGE_SIZE,
  );

  return (
    <div className="pipeline-history">
      {!hasRuns ? (
        <p className="setter-rail-empty">No pipeline runs for this draft yet.</p>
      ) : (
        <>
          {isBuilding && (
            <section className="pipeline-history-section">
              <h4 className="pipeline-history-section-title">Current run</h4>
              <PhaseTracker
                phase={draft.buildCurrentPhase}
                attempt={draft.buildCurrentAttempt || attempts || 1}
                total={maxAttempts}
                status="building"
                validation={draft.buildValidation}
                running
                attemptLabelOnly
                onSelect={onGoPipelineLogs}
              />
            </section>
          )}

          {checklists.length > 0 && (
            <section className="pipeline-history-section">
              <div className="pipeline-history-section-head">
                <h4 className="pipeline-history-section-title">Iterations</h4>
                {checklists.length > PIPELINE_HISTORY_PAGE_SIZE && (
                  <span className="pipeline-history-count dim">
                    {checklists.length} total
                  </span>
                )}
              </div>
              <div className="pipeline-history-trackers">
                {pageChecklists.map((c) => (
                  <ChecklistPhaseTracker
                    key={`iter-${c.attempt}-${c.failedPhase || 'ok'}`}
                    checklist={c}
                    onSelect={onGoPipelineLogs}
                  />
                ))}
              </div>
              {checklists.length > PIPELINE_HISTORY_PAGE_SIZE && (
                <div className="pipeline-history-pagination">
                  <button
                    type="button"
                    className="ghost sm"
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </button>
                  <span className="pipeline-history-page-label">
                    {safePage + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="ghost sm"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function isDraftBuildReadyLocal(d) {
  if (!d?.description?.trim()) return false;
  if (!d?.brokenState?.rootCause?.trim()) return false;
  const services = d?.infra?.services || [];
  if (!services.length) return false;
  return services.every((s) => {
    const svc = typeof s === 'string' ? { name: s } : s;
    return !!svc?.image_hint?.trim();
  });
}

function isBuildSucceeded(draft) {
  if (!draft) return false;
  if (draft.buildStatus === 'review_ready') return true;
  if (draft.buildStatus === 'building') return false;
  const checklists = draft.buildChecklists || [];
  if (!checklists.length) return false;
  const latest = checklists.reduce(
    (best, c) => ((c.attempt || 0) > (best?.attempt || 0) ? c : best),
    null,
  );
  return !!latest?.passed;
}

function isShapeContractCompleteLocal(d) {
  if (!d) return false;
  if (!d.description?.trim()) return false;
  const cats = (d.meta?.catalogueCategories || []).filter((c) => c !== 'global');
  if (!cats.length) return false;
  if (!d.meta?.name?.trim()) return false;
  if (!d.meta?.category?.trim()) return false;
  if (!d.meta?.difficulty?.trim()) return false;
  if (!d.arch?.trim()) return false;
  if (!d.brokenState?.rootCause?.trim()) return false;
  if (!(d.brokenState?.validationSymptoms?.length)) return false;
  if (!(d.infra?.services?.length)) return false;
  return true;
}

function shapeContractMissingLocal(d) {
  const missing = [];
  if (!d?.description?.trim()) missing.push('description');
  const cats = (d?.meta?.catalogueCategories || []).filter((c) => c !== 'global');
  if (!cats.length) missing.push('meta.catalogueCategories');
  if (!d?.meta?.name?.trim()) missing.push('meta.name');
  if (!d?.meta?.category?.trim()) missing.push('meta.category');
  if (!d?.meta?.difficulty?.trim()) missing.push('meta.difficulty');
  if (!d?.arch?.trim()) missing.push('arch');
  if (!d?.brokenState?.rootCause?.trim()) missing.push('brokenState.rootCause');
  if (!(d?.brokenState?.validationSymptoms?.length)) missing.push('brokenState.validationSymptoms');
  if (!(d?.infra?.services?.length)) missing.push('infra.services');
  return missing;
}

function PhaseBadge({ shapePhase, designApproved, draftReady, schemaMaterialized }) {
  const labels = {
    design: 'Phase 1 — Design contract',
    schema: schemaMaterialized && draftReady
      ? 'Ready to build'
      : schemaMaterialized
        ? 'Phase 2 — Schema generated'
        : 'Phase 2 — Generate schema',
    ready: 'Ready to build',
  };
  return (
    <span className={`pill shape-phase ${shapePhase}`}>
      {labels[shapePhase] || shapePhase}
    </span>
  );
}

function DescriptionPanel({ draft, shapePhase, designApproved, schemaMaterialized, shapeContractMissing }) {
  const description = draft?.description?.trim();
  const rootCause = draft?.brokenState?.rootCause?.trim();
  const meta = draft?.meta || {};
  const catalogueCategories = (meta.catalogueCategories || []).filter((c) => c !== 'global');
  const services = (draft?.infra?.services || []).map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean);
  const symptoms = draft?.brokenState?.validationSymptoms || [];
  const arch = draft?.arch?.trim();
  const metricsGuidance = draft?.metrics?.display?.guidance?.trim();
  const missing = shapeContractMissing || [];

  if (!description) {
    return (
      <div className="draft-preview-empty">
        No design contract yet. Describe the incident in chat; the agent will emit a full
        {' '}<code>&lt;shape_contract&gt;</code> JSON block when ready.
      </div>
    );
  }

  const metaRows = [
    meta.category && { label: 'Primary category', value: meta.category },
    meta.difficulty && { label: 'Difficulty', value: meta.difficulty },
    services.length > 0 && { label: 'Services', value: services.join(', ') },
  ].filter(Boolean);

  return (
    <div className="description-panel">
      {meta.name && <h3 className="contract-title">{meta.name}</h3>}

      {catalogueCategories.length > 0 && (
        <div className="contract-pills">
          <span className="contract-pills-label">Catalogue</span>
          {catalogueCategories.map((cat) => (
            <span key={cat} className="contract-pill">{cat}</span>
          ))}
        </div>
      )}

      {metaRows.length > 0 && (
        <dl className="contract-meta-grid">
          {metaRows.map(({ label, value }) => (
            <div key={label} className="contract-meta-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <section className="contract-section">
        <h4 className="contract-section-title">Description</h4>
        <MarkdownProse text={description} className="description-body markdown-prose" />
      </section>

      {arch && (
        <section className="contract-section">
          <h4 className="contract-section-title">Architecture</h4>
          <p className="contract-prose">{arch}</p>
        </section>
      )}

      {symptoms.length > 0 && (
        <section className="contract-section">
          <h4 className="contract-section-title">Validation intent</h4>
          <ol className="contract-list">
            {symptoms.map((s) => (
              <li key={s.order || s.check}>{s.check}</li>
            ))}
          </ol>
        </section>
      )}

      {metricsGuidance && (
        <section className="contract-section">
          <h4 className="contract-section-title">Metrics intent</h4>
          <p className="contract-prose">{metricsGuidance}</p>
        </section>
      )}

      {rootCause && (
        <details className="contract-details setter-only">
          <summary>Root cause (setter-only)</summary>
          <p className="contract-prose">{rootCause}</p>
        </details>
      )}

      {missing.length > 0 && shapePhase === 'design' && !designApproved && (
        <p className="contract-footnote warn">
          Still needed before approve: <strong>{missing.join(', ')}</strong>
        </p>
      )}
      {shapePhase === 'design' && !designApproved && missing.length === 0 && (
        <p className="contract-footnote">
          Design contract complete. Keep chatting to refine, or click <strong>Approve design</strong> when ready.
        </p>
      )}
      {designApproved && !schemaMaterialized && (
        <p className="contract-footnote">
          Design approved. Click <strong>Generate schema</strong> above to materialize services and enable build.
        </p>
      )}
    </div>
  );
}

function ShapePreviewPanel({
  draft,
  shapePhase,
  designApproved,
  schemaMaterialized,
  shapeContractMissing,
}) {
  const d = draft?.draft;
  const showSchema = !!schemaMaterialized;

  if (showSchema) {
    return <SchemaPreview draft={d} compact />;
  }

  return (
    <DescriptionPanel
      draft={d}
      shapePhase={shapePhase}
      designApproved={designApproved}
      schemaMaterialized={schemaMaterialized}
      shapeContractMissing={shapeContractMissing}
    />
  );
}

function SchemaPreview({ draft, compact = false }) {
  if (!draft?.infra?.services?.length) {
    return (
      <div className="draft-preview-empty">
        Schema not generated yet. Approve the description, then run <strong>Generate schema</strong>.
      </div>
    );
  }
  const meta = draft.meta || {};
  const title = meta.name || draft.title || '—';
  const description = (draft.description || meta.description || '').trim();
  const serviceNames = (draft.infra?.services || [])
    .map((s) => (typeof s === 'string' ? s : s.name))
    .filter(Boolean);
  const symptoms = draft.brokenState?.validationSymptoms || [];
  const rootCause = draft.brokenState?.rootCause?.trim();
  const observeCount = draft.metrics?.observe?.length || 0;

  if (compact) {
    return (
      <div className="preview-compact">
        <h4 className="preview-compact-title">{title}</h4>
        {meta.category && (
          <span className="preview-compact-pill">{meta.category}</span>
        )}
        {description ? (
          <section className="preview-compact-section">
            <span className="preview-compact-label">Description</span>
            <MarkdownProse text={description} className="preview-compact-description markdown-prose" />
          </section>
        ) : (
          <p className="preview-compact-stats dim">No description yet.</p>
        )}
        {serviceNames.length > 0 && (
          <div className="preview-compact-section">
            <span className="preview-compact-label">Services</span>
            <ul className="preview-compact-chips">
              {serviceNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="preview-compact-stats dim">
          {symptoms.length} validation step{symptoms.length === 1 ? '' : 's'}
          {observeCount > 0 ? ` · ${observeCount} observable${observeCount === 1 ? '' : 's'}` : ''}
        </p>
        {rootCause && (
          <details className="preview-compact-details">
            <summary>Root cause (setter-only)</summary>
            <p className="preview-compact-prose">{rootCause}</p>
          </details>
        )}
        <details className="preview-compact-details">
          <summary>Validation checklist</summary>
          <DesignValidationChecklist draft={draft} />
        </details>
        <details className="preview-compact-details">
          <summary>Full JSON</summary>
          <pre className="preview-compact-json">{JSON.stringify(draft, null, 2)}</pre>
        </details>
      </div>
    );
  }

  return (
    <div className="draft-preview">
      <div className="row">
        <span className="label">Title</span>
        <span className="value">{title}</span>
      </div>
      <div className="row col">
        <span className="label">Description</span>
        {description ? (
          <MarkdownProse text={description} className="value markdown-prose draft-preview-description" />
        ) : (
          <span className="value">—</span>
        )}
      </div>
      <div className="row">
        <span className="label">Category</span>
        <span className="value">{meta.category || '—'}</span>
      </div>
      <div className="row">
        <span className="label">Services (catalogue)</span>
        <span className="value">{serviceNames.join(', ') || '—'}</span>
      </div>
      <div className="row">
        <span className="label">Observables</span>
        <span className="value">{observeCount || '—'}</span>
      </div>
      <div className="row col">
        <span className="label">Root cause</span>
        <span className="value">{rootCause || '—'}</span>
      </div>
      <DesignValidationChecklist draft={draft} />
      <details className="json-toggle">
        <summary>Full JSON</summary>
        <pre>{JSON.stringify(draft, null, 2)}</pre>
      </details>
    </div>
  );
}

export default function ProblemSetterPage({
  draft,
  llmConfig,
  onGoPipelineLogs,
  onGoBuild,
  onGoReview,
  onDraftChanged,
  onImportDraft,
  onDeleteDraft,
  onRefreshSession,
}) {
  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  const shapePhase = draft?.shapePhase || 'design';
  const designApproved = !!draft?.designApproved;
  const schemaMaterialized = !!draft?.schemaMaterialized;
  const llmReady = !!llmConfig?.llmConfigured;
  const canChat = shapePhase === 'design' && !designApproved;
  const shapeContractComplete = draft?.shapeContractComplete
    ?? isShapeContractCompleteLocal(draft?.draft);
  const shapeContractMissing = (draft?.shapeContractMissing?.length
    && draft?.shapeContractComplete === false
    && !isShapeContractCompleteLocal(draft?.draft))
    ? draft.shapeContractMissing
    : shapeContractMissingLocal(draft?.draft);
  const schemaReadyForBuild = !!(
    schemaMaterialized
    && (draft?.draftReady || isDraftBuildReadyLocal(draft?.draft))
  );
  const canRevise = designApproved && !schemaMaterialized;
  const canApprove = !designApproved && llmReady && shapeContractComplete;
  const canGenerateSchema = designApproved && !schemaMaterialized && llmReady && shapeContractComplete;
  const buildSucceeded = isBuildSucceeded(draft);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 80;
    if (nearBottom || streamingText) {
      el.scrollTop = el.scrollHeight;
    }
  }, [draft?.messages?.length, streamingText]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  if (!draft) {
    return <Empty onImport={onImportDraft} />;
  }

  const send = async () => {
    if (!input.trim() || busy || !llmReady || !canChat) return;
    const msg = input.trim();
    setInput('');
    setBusy(true);
    setErr(null);
    setStreamingText('');

    const optimistic = {
      ...draft,
      messages: [...(draft.messages || []), { role: 'user', content: msg }],
    };
    onDraftChanged(optimistic);

    const controller = new AbortController();
    abortRef.current = controller;

    let assistantText = '';
    let partial = optimistic.draft || {};
    try {
      await streamChat(draft.id, msg, (ev) => {
        if (ev.type === 'text') {
          assistantText += ev.delta;
          setStreamingText(assistantText);
        } else if (ev.type === 'design') {
          const ex = ev.extracted || {};
          partial = {
            ...partial,
            description: ex.description,
            arch: ex.arch || partial.arch,
            meta: {
              ...(partial.meta || {}),
              ...(ex.meta || {}),
              ...(ex.catalogueCategories?.length
                ? { catalogueCategories: ex.catalogueCategories }
                : {}),
            },
            infra: ex.infra?.services?.length
              ? { ...(partial.infra || {}), services: ex.infra.services }
              : partial.infra,
            brokenState: ex.brokenState
              ? { ...(partial.brokenState || {}), ...ex.brokenState }
              : partial.brokenState,
            metrics: ex.metricsIntent
              ? {
                ...(partial.metrics || {}),
                enabled: ex.metricsIntent.enabled ?? partial.metrics?.enabled,
                display: {
                  ...(partial.metrics?.display || {}),
                  ...(ex.metricsIntent.guidance
                    ? { guidance: ex.metricsIntent.guidance }
                    : {}),
                },
              }
              : partial.metrics,
          };
        } else if (ev.type === 'shape') {
          // Applied after stream via onRefreshSession
        } else if (ev.type === 'error') {
          setErr(ev.message);
        }
      }, { signal: controller.signal });

      onDraftChanged({
        ...optimistic,
        messages: [...optimistic.messages, { role: 'assistant', content: assistantText }],
        draft: partial,
        shapeContractComplete: isShapeContractCompleteLocal(partial),
        shapeContractMissing: shapeContractMissingLocal(partial),
      });
      if (onRefreshSession) await onRefreshSession();
      setStreamingText('');
    } catch (e) {
      if (e.name !== 'AbortError') setErr(e.message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const runGenerateSchema = async () => {
    setStreamingText('');
    const controller = new AbortController();
    abortRef.current = controller;

    let assistantText = '';
    let sessionPatch = draft;
    await generateSchema(draft.id, (ev) => {
      if (ev.type === 'text') {
        assistantText += ev.delta;
        setStreamingText(assistantText);
      } else if (ev.type === 'error') {
        setErr(ev.message);
      } else if (ev.type === 'draft' && onDraftChanged) {
        sessionPatch = {
          ...sessionPatch,
          draft: ev.draft,
          schemaMaterialized: true,
        };
        onDraftChanged(sessionPatch);
      } else if (ev.type === 'shape' && onDraftChanged) {
        sessionPatch = {
          ...sessionPatch,
          shapePhase: ev.shapePhase,
          draftReady: ev.draftReady,
          schemaMaterialized: true,
        };
        onDraftChanged(sessionPatch);
      }
    }, { signal: controller.signal });

    if (onRefreshSession) {
      await onRefreshSession();
    }
    setStreamingText('');
  };

  const handleApproveDesign = async () => {
    if (!canApprove || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await approveDesign(draft.id);
      if (onRefreshSession) await onRefreshSession();
    } catch (e) {
      setErr(e?.response?.data?.error
        || (e?.response?.data?.missing?.length
          ? `${e.response.data.error}: ${e.response.data.missing.join(', ')}`
          : null)
        || e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateSchema = async () => {
    if (!canGenerateSchema || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await runGenerateSchema();
    } catch (e) {
      if (e.name !== 'AbortError') {
        setErr(e?.response?.data?.error || e.message);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const handleRevise = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { draft: updated } = await reviseDesign(draft.id);
      if (onRefreshSession) await onRefreshSession();
      else onDraftChanged(updated);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  const inputPlaceholder = !llmReady
    ? 'Set API key in backend/.env'
    : canChat
      ? 'Describe the incident, broken state, and what candidates should fix…'
      : schemaReadyForBuild
        ? 'Schema ready — start Build pipeline in the right panel'
        : designApproved
          ? 'Generate schema in Preview to continue'
          : 'Approve design in Preview when the contract is complete';

  return (
    <div className="setter-intent-layout">
      <aside className="setter-intent-preview" aria-label="Design preview">
        <div className="setter-rail-card panel setter-rail-card--preview">
          <div className="setter-rail-card-header setter-rail-card-header--stacked">
            <h3 className="setter-rail-card-title">Preview</h3>
            <div className="setter-preview-actions">
              {canApprove && (
                <button
                  type="button"
                  className="sm"
                  disabled={busy}
                  onClick={handleApproveDesign}
                  title={
                    !llmReady
                      ? 'LLM not configured'
                      : !shapeContractComplete
                        ? `Complete contract first: ${shapeContractMissing.join(', ')}`
                        : 'Lock the design contract and move to schema generation'
                  }
                >
                  {busy ? 'Approving…' : 'Approve design'}
                </button>
              )}
              {canGenerateSchema && (
                <button
                  type="button"
                  className="sm"
                  disabled={busy}
                  onClick={handleGenerateSchema}
                  title="Generate catalogue schema and image hints from the approved contract"
                >
                  {busy ? 'Generating schema…' : 'Generate schema'}
                </button>
              )}
              {canRevise && (
                <button
                  type="button"
                  className="ghost sm"
                  disabled={busy}
                  onClick={handleRevise}
                >
                  Edit contract
                </button>
              )}
            </div>
            {!designApproved && !shapeContractComplete && shapeContractMissing.length > 0 && (
              <p className="setter-preview-hint dim">
                Still needed: {shapeContractMissing.join(', ')}
              </p>
            )}
            {canGenerateSchema && (
              <p className="setter-preview-hint dim">
                Design approved — run <strong>Generate schema</strong> to enable build.
              </p>
            )}
            {schemaReadyForBuild && (
              <p className="setter-preview-hint dim">
                Schema ready — use <strong>Build pipeline</strong> on the right.
              </p>
            )}
            {err && <p className="setter-preview-hint alert-inline">{err}</p>}
          </div>
          <div className="setter-rail-card-body">
            <ShapePreviewPanel
              draft={draft}
              shapePhase={shapePhase}
              designApproved={designApproved}
              schemaMaterialized={schemaMaterialized}
              shapeContractMissing={shapeContractMissing}
            />
          </div>
        </div>
      </aside>

      <section className="setter-intent-column panel">
        <div className="chat-scroll" ref={scrollRef}>
          {(draft.messages || []).length === 0 && (
            <div className="chat-intro setter-intent-intro">
              <p className="setter-intent-intro-lead">
                Describe the production incident you want candidates to debug.
              </p>
              <p className="dim">
                The agent will shape a full design contract — story, services, root cause, and
                validation intent — when you are ready.
              </p>
            </div>
          )}
          {(draft.messages || []).map((m, i) => (
            <ChatBubble key={i} role={m.role} content={m.content} />
          ))}
          {streamingText && <ChatBubble role="assistant" content={streamingText} />}
        </div>

        <div className="chat-input setter-intent-input">
          <div className="setter-intent-composer">
            <textarea
              placeholder={inputPlaceholder}
              disabled={!llmReady || busy || !canChat}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              aria-keyshortcuts="Meta+Enter Control+Enter"
            />
            <button
              type="button"
              className="setter-intent-send"
              onClick={send}
              disabled={!llmReady || busy || !canChat || !input.trim()}
              aria-label={busy && canChat ? 'Sending' : 'Send message'}
              title="Send (⌘/Ctrl + Enter)"
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 4v8M8 4l3.25 3.25M8 4L4.75 7.25"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <aside className="setter-intent-rail" aria-label="Pipeline history">
        <div className="setter-rail-card panel setter-rail-card--history">
          <div className="setter-rail-card-header setter-rail-card-header--stacked">
            <h3 className="setter-rail-card-title">Pipeline history</h3>
            <div className="setter-preview-actions">
              {buildSucceeded && onGoReview && (
                <button
                  type="button"
                  className="primary sm"
                  onClick={onGoReview}
                  title="Open Ship to inspect the build and push to your library"
                >
                  Open review →
                </button>
              )}
              <button
                type="button"
                className="sm"
                disabled={!schemaReadyForBuild || busy}
                onClick={onGoBuild}
                title={
                  schemaReadyForBuild
                    ? buildSucceeded
                      ? 'Open the Build tab to rebuild'
                      : 'Open the Build tab and run the pipeline'
                    : 'Generate schema in Preview first'
                }
              >
                {buildSucceeded ? 'Rebuild' : 'Build pipeline'}
              </button>
            </div>
            <p className="setter-preview-hint dim">
              {buildSucceeded
                ? 'Build passed — open review to ship to your library.'
                : schemaReadyForBuild
                  ? 'Schema ready — run the build to validate in Docker.'
                  : designApproved
                    ? 'Generate schema in Preview to enable build.'
                    : 'Approve design and generate schema before building.'}
            </p>
          </div>
          <div className="setter-rail-card-body">
            <PipelineHistoryRail draft={draft} onGoPipelineLogs={onGoPipelineLogs} />
          </div>
        </div>
      </aside>
    </div>
  );
}
