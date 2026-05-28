import React, { useEffect, useRef, useState } from 'react';
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

function DescriptionPanel({ draft, shapePhase, designApproved, shapeContractMissing }) {
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
        <h4 className="contract-section-title">Candidate story</h4>
        <div className="description-body">{description}</div>
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
    </div>
  );
}

function SchemaPreview({ draft }) {
  if (!draft?.infra?.services?.length) {
    return (
      <div className="draft-preview-empty">
        Schema not generated yet. Approve the description, then run <strong>Generate schema</strong>.
      </div>
    );
  }
  const meta = draft.meta || {};
  const title = meta.name || draft.title || '—';
  const services = (draft.infra?.services || [])
    .map((s) => (typeof s === 'string' ? s : `${s.name} (${s.image_hint || '?'})`))
    .filter(Boolean);
  const observeCount = draft.metrics?.observe?.length || 0;

  return (
    <div className="draft-preview">
      <div className="row">
        <span className="label">Title</span>
        <span className="value">{title}</span>
      </div>
      <div className="row">
        <span className="label">Category</span>
        <span className="value">{meta.category || '—'}</span>
      </div>
      <div className="row">
        <span className="label">Services (catalogue)</span>
        <span className="value">{services.join(', ') || '—'}</span>
      </div>
      <div className="row">
        <span className="label">Observables</span>
        <span className="value">{observeCount || '—'}</span>
      </div>
      <div className="row col">
        <span className="label">Root cause</span>
        <span className="value">{draft.brokenState?.rootCause || '—'}</span>
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
  draft, llmConfig, onDraftChanged, onImportDraft, onDeleteDraft, onGoPipeline, onRefreshSession,
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
  const draftReady = !!draft?.draftReady || isDraftBuildReadyLocal(draft?.draft);
  const llmReady = !!llmConfig?.llmConfigured;
  const canChat = shapePhase === 'design' && !designApproved;
  const shapeContractComplete = draft?.shapeContractComplete
    ?? isShapeContractCompleteLocal(draft?.draft);
  const shapeContractMissing = (draft?.shapeContractMissing?.length
    && draft?.shapeContractComplete === false
    && !isShapeContractCompleteLocal(draft?.draft))
    ? draft.shapeContractMissing
    : shapeContractMissingLocal(draft?.draft);
  const canApprove = canChat && shapeContractComplete;
  const canGenerateSchema = designApproved && shapePhase === 'schema' && llmReady;
  const canRevise = designApproved && shapePhase !== 'ready';
  const canGoBuild = (!!draft?.draftReady || isDraftBuildReadyLocal(draft?.draft)) && schemaMaterialized;
  const schemaIncomplete = schemaMaterialized && !draftReady && !isDraftBuildReadyLocal(draft?.draft);
  const showSchema = schemaMaterialized || draftReady || shapePhase === 'ready'
    || (designApproved && (draft?.draft?.infra?.services || []).some(
      (s) => typeof s === 'object' && s.image_hint,
    ));

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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

  const handleApprove = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { draft: updated } = await approveDesign(draft.id);
      if (onRefreshSession) await onRefreshSession();
      else onDraftChanged(updated);
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

  const handleGenerateSchema = async () => {
    setBusy(true);
    setErr(null);
    setStreamingText('');
    const controller = new AbortController();
    abortRef.current = controller;

    let assistantText = '';
    let sessionPatch = draft;
    try {
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
    } catch (e) {
      if (e.name !== 'AbortError') setErr(e.message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const buildDisabled = busy || !draftReady || !llmReady;

  return (
    <div className="setter-grid">
      <section className="chat-col panel">
        <div className="panel-header">
          <div className="title">
            <span className="logo-dot" />
            {draft.draft?.meta?.name || draft.draft?.title || 'New draft'}
            <PhaseBadge
              shapePhase={shapePhase}
              designApproved={designApproved}
              draftReady={draftReady}
              schemaMaterialized={schemaMaterialized}
            />
          </div>
          <button type="button" className="ghost danger sm" onClick={() => onDeleteDraft(draft.id)}>
            Delete draft
          </button>
        </div>
        <div className="chat-scroll" ref={scrollRef}>
          {(draft.messages || []).length === 0 && (
            <div className="chat-intro">
              <strong>Phase 1:</strong> Define the full design contract — story, catalogue rows, architecture,
              service names, root cause, and validation intent. The agent emits{' '}
              <code>&lt;shape_contract&gt;</code> JSON when ready.
            </div>
          )}
          {(draft.messages || []).map((m, i) => (
            <ChatBubble key={i} role={m.role} content={m.content} />
          ))}
          {streamingText && <ChatBubble role="assistant" content={streamingText} />}
        </div>
        {err && <div className="alert" style={{ margin: '0 14px 12px' }}>{err}</div>}
        <div className="chat-input">
          <textarea
            placeholder={
              !llmReady
                ? 'Set API key in backend/.env'
                : canChat
                  ? 'Ask follow-ups or refine the design contract…'
                  : canGoBuild
                    ? 'Schema ready — click Build → Pipeline in the panel above →'
                    : schemaMaterialized
                      ? 'Schema generated — review the panel or regenerate if needed →'
                      : 'Description locked — use Edit contract or Generate schema →'
            }
            disabled={!llmReady || busy || !canChat}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            rows={3}
          />
          <div className="chat-actions">
            <span className="hint">⌘/Ctrl + Enter to send</span>
            <button type="button" onClick={send} disabled={!llmReady || busy || !canChat || !input.trim()}>
              {busy && canChat ? 'Streaming…' : 'Send'}
            </button>
          </div>
        </div>
      </section>

      <section className="draft-col panel">
        <div className="panel-header">
          <div className="title">{showSchema ? 'Schema preview' : 'Problem statement'}</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {canApprove && (
              <button type="button" className="sm" disabled={busy} onClick={handleApprove}>
                Approve design
              </button>
            )}
            {canRevise && (
              <button type="button" className="ghost sm" disabled={busy} onClick={handleRevise}>
                Edit contract
              </button>
            )}
            {canGenerateSchema && (
              <button type="button" className="sm" disabled={busy} onClick={handleGenerateSchema}>
                {busy ? 'Generating…' : schemaMaterialized ? 'Regenerate schema' : 'Generate schema'}
              </button>
            )}
            {canGoBuild && (
              <button
                type="button"
                className="primary sm"
                disabled={buildDisabled}
                onClick={onGoPipeline}
                title="Open build pipeline"
              >
                Build → Pipeline
              </button>
            )}
          </div>
        </div>
        <div className="panel-body" style={{ overflow: 'auto' }}>
          {showSchema ? (
            <SchemaPreview draft={draft.draft} />
          ) : (
            <DescriptionPanel
              draft={draft.draft}
              shapePhase={shapePhase}
              designApproved={designApproved}
              shapeContractMissing={shapeContractMissing}
            />
          )}
        </div>
      </section>
    </div>
  );
}
