import React, { useRef, useState, useEffect, useCallback } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';

loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' } });

const LANGUAGES = [
  { id: 'shell', label: 'Shell' },
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'sql', label: 'SQL' },
  { id: 'yaml', label: 'YAML' },
  { id: 'json', label: 'JSON' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'plaintext', label: 'Plain text' },
];

const EXT_MAP = {
  py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
  sql: 'sql', yml: 'yaml', yaml: 'yaml', json: 'json',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  conf: 'plaintext', cfg: 'plaintext', ini: 'plaintext', env: 'plaintext',
  md: 'markdown', toml: 'plaintext', xml: 'xml', html: 'html', css: 'css',
};

// Dockerfile has no extension — match by basename
function detectLanguage(filePath) {
  if (!filePath) return 'shell';
  const base = filePath.split('/').pop();
  if (/^dockerfile$/i.test(base)) return 'dockerfile';
  if (/^docker-compose/i.test(base)) return 'yaml';
  if (/^nginx\.conf$/i.test(base)) return 'plaintext';
  const ext = base.split('.').pop().toLowerCase();
  return EXT_MAP[ext] || 'plaintext';
}

const THEME_NAME = 'devlabs-dark';

function defineTheme(monaco) {
  monaco.editor.defineTheme(THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '4a5273', fontStyle: 'italic' },
      { token: 'keyword', foreground: '38bdf8' },
      { token: 'string', foreground: '6ee7b7' },
      { token: 'number', foreground: 'fb923c' },
      { token: 'type', foreground: '93c5fd' },
      { token: 'variable', foreground: 'eef0ff' },
      { token: 'function', foreground: '34d399' },
      { token: 'operator', foreground: '98a2c2' },
    ],
    colors: {
      'editor.background': '#05080f',
      'editor.foreground': '#eef0ff',
      'editor.lineHighlightBackground': '#0d1220',
      'editor.selectionBackground': '#1d2545',
      'editor.inactiveSelectionBackground': '#161d36',
      'editorCursor.foreground': '#34d399',
      'editorLineNumber.foreground': '#2d3655',
      'editorLineNumber.activeForeground': '#6c7595',
      'editorIndentGuide.background': '#161d36',
      'editorIndentGuide.activeBackground': '#1d2545',
      'editorWidget.background': '#11172b',
      'editorWidget.border': 'rgba(255,255,255,0.06)',
      'editorSuggestWidget.background': '#11172b',
      'editorSuggestWidget.border': 'rgba(255,255,255,0.06)',
      'editorSuggestWidget.selectedBackground': '#1d2545',
      'input.background': '#0a0e1a',
      'input.border': 'rgba(255,255,255,0.06)',
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': 'rgba(255,255,255,0.06)',
      'scrollbarSlider.hoverBackground': 'rgba(255,255,255,0.12)',
      'scrollbarSlider.activeBackground': 'rgba(255,255,255,0.18)',
    },
  });
}

// save status: 'idle' | 'saving' | 'saved' | 'error'
const STATUS_LABEL = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' };
const STATUS_COLOR = {
  idle: 'var(--text-dim)',
  saving: 'var(--text-muted)',
  saved: 'var(--brand-bright)',
  error: 'var(--danger)',
};

export default function CodeEditor({ sessionId, services = [], defaultContainer }) {
  const [pathInput, setPathInput] = useState('');
  const [openedPath, setOpenedPath] = useState('');
  const [container, setContainer] = useState(defaultContainer || services[0] || '');
  const [language, setLanguage] = useState('shell');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle');
  const saveTimer = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);

  // Keep container in sync if services change and nothing selected yet
  useEffect(() => {
    if (!container && services.length > 0) setContainer(services[0]);
  }, [services, container]);

  function handleMount(editor, monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;
    defineTheme(monaco);
    monaco.editor.setTheme(THEME_NAME);

    // Ctrl+S / Cmd+S → save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });
  }

  async function openFile(path, ctr) {
    if (!sessionId || !path.trim()) return;
    setLoading(true);
    setLoadError('');
    setSaveStatus('idle');
    try {
      const params = new URLSearchParams({ path: path.trim(), container: ctr || container });
      const r = await fetch(`/api/session/${sessionId}/file?${params}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      setContent(data.content);
      setOpenedPath(path.trim());
      setLanguage(detectLanguage(path.trim()));
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const handleSave = useCallback(async () => {
    if (!sessionId || !openedPath || saveStatus === 'saving') return;
    const currentContent = editorRef.current?.getValue() ?? content;
    setSaveStatus('saving');
    try {
      const r = await fetch(`/api/session/${sessionId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: openedPath, content: currentContent, container }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      setSaveStatus('saved');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveStatus('idle'), 2500);
    } catch (e) {
      setSaveStatus('error');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveStatus('idle'), 3500);
    }
  }, [sessionId, openedPath, container, content, saveStatus]);

  function handlePathKeyDown(e) {
    if (e.key === 'Enter') openFile(pathInput, container);
  }

  const hasFile = Boolean(openedPath);

  return (
    <div className="code-editor-root">
      {/* ── path bar ── */}
      <div className="code-editor-path-bar">
        {services.length > 1 && (
          <select
            className="code-editor-container-select"
            value={container}
            onChange={(e) => setContainer(e.target.value)}
            aria-label="Container"
            title="Target container"
          >
            {services.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        <input
          className="code-editor-path-input"
          type="text"
          placeholder="/etc/nginx/nginx.conf"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={handlePathKeyDown}
          spellCheck={false}
          aria-label="File path"
        />
        <button
          type="button"
          className="code-editor-open-btn"
          onClick={() => openFile(pathInput, container)}
          disabled={loading || !pathInput.trim() || !sessionId}
          title="Open file (Enter)"
        >
          {loading ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : 'Open'}
        </button>
      </div>

      {/* ── header: filename + controls ── */}
      <div className="code-editor-header">
        <div className="title">
          <span className="icon" style={{ color: 'var(--accent)', fontSize: 10 }}>&#9632;</span>
          {hasFile
            ? <span className="code-editor-filename" title={openedPath}>{openedPath.split('/').pop()}</span>
            : <span style={{ color: 'var(--text-dim)' }}>Editor</span>
          }
          {loadError && (
            <span style={{ color: 'var(--danger)', fontSize: 10, marginLeft: 6 }}>
              ✕ {loadError}
            </span>
          )}
        </div>
        <div className="code-editor-controls">
          {hasFile && (
            <span
              className="code-editor-save-status"
              style={{ color: STATUS_COLOR[saveStatus] }}
            >
              {STATUS_LABEL[saveStatus]}
            </span>
          )}
          {hasFile && (
            <button
              type="button"
              className="code-editor-save-btn"
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              title="Save (Ctrl+S)"
            >
              Save
            </button>
          )}
          <select
            className="code-editor-lang-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── monaco ── */}
      <div className="code-editor-body">
        <MonacoEditor
          language={language}
          value={content}
          theme={THEME_NAME}
          onMount={handleMount}
          onChange={(val) => setContent(val ?? '')}
          options={{
            fontSize: 13,
            fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
            fontLigatures: true,
            lineHeight: 20,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 10, bottom: 10 },
            renderLineHighlight: 'line',
            cursorBlinking: 'smooth',
            smoothScrolling: true,
            tabSize: 2,
            wordWrap: 'off',
            folding: true,
            lineNumbers: 'on',
            glyphMargin: false,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            readOnly: !hasFile,
            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          }}
        />
      </div>
    </div>
  );
}
