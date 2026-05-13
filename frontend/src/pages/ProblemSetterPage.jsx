import React, { useEffect, useRef, useState } from 'react';
import { streamChat } from '../services/problemApi.js';

function Empty({ onImport }) {
  const [text, setText] = useState('');
  const [showImport, setShowImport] = useState(false);
  return (
    <div className="setter-empty">
      <div className="hero">
        <h2>Problem Setter</h2>
        <p>Pick a draft from the sidebar, start a new one, or paste a draft JSON below.</p>
      </div>
      {showImport ? (
        <div className="import-box">
          <textarea
            placeholder='{ "title": "...", "sandboxSpec": { ... } }'
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="actions">
            <button className="ghost" onClick={() => setShowImport(false)}>Cancel</button>
            <button onClick={() => onImport(text)} disabled={!text.trim()}>Import draft</button>
          </div>
        </div>
      ) : (
        <button className="ghost" onClick={() => setShowImport(true)}>Import draft JSON…</button>
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

function DraftPreview({ draft }) {
  if (!draft) {
    return (
      <div className="draft-preview-empty">
        No draft yet. The agent will populate this as soon as you describe a concrete brokenState.
      </div>
    );
  }
  return (
    <div className="draft-preview">
      <div className="row">
        <span className="label">Title</span>
        <span className="value">{draft.title || '—'}</span>
      </div>
      <div className="row">
        <span className="label">Difficulty</span>
        <span className="value">{draft.difficulty || '—'}</span>
      </div>
      <div className="row">
        <span className="label">Category</span>
        <span className="value">{draft.category || '—'}</span>
      </div>
      <div className="row">
        <span className="label">Tags</span>
        <span className="value">{(draft.tags || []).join(', ') || '—'}</span>
      </div>
      <div className="row col">
        <span className="label">Incident</span>
        <span className="value">{draft.problemStatement?.incident || '—'}</span>
      </div>
      <div className="row col">
        <span className="label">Broken state</span>
        <span className="value">{draft.sandboxSpec?.brokenState || '—'}</span>
      </div>
      <div className="row col">
        <span className="label">Validation approach</span>
        <span className="value">{draft.sandboxSpec?.validationApproach || '—'}</span>
      </div>
      <div className="row col">
        <span className="label">Services</span>
        <span className="value">{(draft.sandboxSpec?.services || []).join(' · ') || '—'}</span>
      </div>
      <details className="json-toggle">
        <summary>Full JSON</summary>
        <pre>{JSON.stringify(draft, null, 2)}</pre>
      </details>
    </div>
  );
}

export default function ProblemSetterPage({
  draft, llmConfig, onDraftChanged, onImportDraft, onDeleteDraft, onGoPipeline,
}) {
  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [draft?.messages?.length, streamingText]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  if (!draft) {
    return <Empty onImport={onImportDraft} />;
  }

  const llmReady = !!llmConfig?.llmConfigured;
  const hasSandboxSpec = !!draft.draft?.sandboxSpec;

  const send = async () => {
    if (!input.trim() || busy || !llmReady) return;
    const msg = input.trim();
    setInput('');
    setBusy(true);
    setErr(null);
    setStreamingText('');

    // optimistically append the user's message
    const optimistic = {
      ...draft,
      messages: [...(draft.messages || []), { role: 'user', content: msg }],
    };
    onDraftChanged(optimistic);

    const controller = new AbortController();
    abortRef.current = controller;

    let assistantText = '';
    let nextDraft = optimistic.draft;
    try {
      await streamChat(draft.id, msg, (ev) => {
        if (ev.type === 'text') {
          assistantText += ev.delta;
          setStreamingText(assistantText);
        } else if (ev.type === 'draft') {
          nextDraft = ev.draft;
        } else if (ev.type === 'error') {
          setErr(ev.message);
        }
      }, { signal: controller.signal });

      const finalDraft = {
        ...optimistic,
        messages: [...optimistic.messages, { role: 'assistant', content: assistantText }],
        draft: nextDraft || optimistic.draft,
      };
      onDraftChanged(finalDraft);
      setStreamingText('');
    } catch (e) {
      if (e.name !== 'AbortError') setErr(e.message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const buildDisabled = busy || !hasSandboxSpec || !llmReady;

  return (
    <div className="setter-grid">
      <section className="chat-col panel">
        <div className="panel-header">
          <div className="title">
            <span className="logo-dot" />
            {draft.draft?.title || 'New draft'}
          </div>
          <button className="ghost danger sm" onClick={() => onDeleteDraft(draft.id)}>
            Delete draft
          </button>
        </div>
        <div className="chat-scroll" ref={scrollRef}>
          {(draft.messages || []).length === 0 && (
            <div className="chat-intro">
              Describe the scenario you want to test. Mention the services involved
              and what should be broken (e.g. <em>"a Postgres orders table is missing
              an index, so /orders/&lt;user_id&gt; lookups take 300–600ms"</em>).
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
            placeholder={llmReady ? 'Describe the broken state…' : 'Set ANTHROPIC_API_KEY in backend/.env to enable chat'}
            disabled={!llmReady || busy}
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
            <button onClick={send} disabled={!llmReady || busy || !input.trim()}>
              {busy ? 'Streaming…' : 'Send'}
            </button>
          </div>
        </div>
      </section>

      <section className="draft-col panel">
        <div className="panel-header">
          <div className="title">Draft preview</div>
          <button
            className="primary sm"
            disabled={buildDisabled}
            onClick={onGoPipeline}
            title={!hasSandboxSpec ? 'Sketch a sandboxSpec first' : !llmReady ? 'LLM not configured' : 'Open the pipeline tab to start a build'}
          >
            Build → Pipeline
          </button>
        </div>
        <div className="panel-body" style={{ overflow: 'auto' }}>
          <DraftPreview draft={draft.draft} />
        </div>
      </section>
    </div>
  );
}
