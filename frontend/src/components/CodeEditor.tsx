import React, { useRef, useState, useEffect, useCallback } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import type * as Monaco from 'monaco-editor';

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

const EXT_MAP: Record<string, string> = {
  py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
  sql: 'sql', yml: 'yaml', yaml: 'yaml', json: 'json',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  conf: 'plaintext', cfg: 'plaintext', ini: 'plaintext', env: 'plaintext',
  md: 'markdown', toml: 'plaintext', xml: 'xml', html: 'html', css: 'css',
};

function detectLanguage(filePath: string): string {
  if (!filePath) return 'shell';
  const base = filePath.split('/').pop() ?? '';
  if (/^dockerfile$/i.test(base)) return 'dockerfile';
  if (/^docker-compose/i.test(base)) return 'yaml';
  if (/^nginx\.conf$/i.test(base)) return 'plaintext';
  const ext = (base.split('.').pop() ?? '').toLowerCase();
  return EXT_MAP[ext] || 'plaintext';
}

const THEME_NAME = 'devlabs-dark';

function defineTheme(monaco: typeof Monaco): void {
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
      'editor.background': '#000000',
      'editor.foreground': '#eef0ff',
      'editor.lineHighlightBackground': '#0a0a0a',
      'editor.selectionBackground': '#222222',
      'editor.inactiveSelectionBackground': '#1a1a1a',
      'editorCursor.foreground': '#34d399',
      'editorLineNumber.foreground': '#444444',
      'editorLineNumber.activeForeground': '#888888',
      'editorIndentGuide.background': '#1a1a1a',
      'editorIndentGuide.activeBackground': '#333333',
      'editorWidget.background': '#111111',
      'editorWidget.border': 'rgba(255,255,255,0.06)',
      'editorSuggestWidget.background': '#111111',
      'editorSuggestWidget.border': 'rgba(255,255,255,0.06)',
      'editorSuggestWidget.selectedBackground': '#222222',
      'input.background': '#000000',
      'input.border': 'rgba(255,255,255,0.06)',
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': 'rgba(255,255,255,0.06)',
      'scrollbarSlider.hoverBackground': 'rgba(255,255,255,0.12)',
      'scrollbarSlider.activeBackground': 'rgba(255,255,255,0.18)',
    },
  });
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const STATUS_LABEL: Record<SaveStatus, string> = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' };
const STATUS_COLOR: Record<SaveStatus, string> = {
  idle: 'var(--text-dim)',
  saving: 'var(--text-muted)',
  saved: 'var(--brand-bright)',
  error: 'var(--danger)',
};

interface CodeEditorProps {
  sessionId: string | null;
  services?: string[];
  defaultContainer?: string;
}

export default function CodeEditor({ sessionId, services = [], defaultContainer }: CodeEditorProps): JSX.Element {
  const [pathInput, setPathInput] = useState<string>('');
  const [openedPath, setOpenedPath] = useState<string>('');
  const [container, setContainer] = useState<string>(defaultContainer || services[0] || '');
  const [language, setLanguage] = useState<string>('shell');
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);

  useEffect(() => {
    if (!container && services.length > 0) setContainer(services[0]);
  }, [services, container]);

  function handleMount(editor: MonacoEditorNS.IStandaloneCodeEditor, monaco: typeof Monaco): void {
    editorRef.current = editor;
    monacoRef.current = monaco;
    defineTheme(monaco);
    monaco.editor.setTheme(THEME_NAME);

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });
  }

  async function openFile(path: string, ctr: string): Promise<void> {
    if (!sessionId || !path.trim()) return;
    setLoading(true);
    setLoadError('');
    setSaveStatus('idle');
    try {
      const params = new URLSearchParams({ path: path.trim(), container: ctr || container });
      const r = await fetch(`/api/session/${sessionId}/file?${params}`);
      const data = await r.json() as { content?: string; error?: string };
      if (!r.ok) throw new Error(data.error || r.statusText);
      setContent(data.content ?? '');
      setOpenedPath(path.trim());
      setLanguage(detectLanguage(path.trim()));
    } catch (e: unknown) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const handleSave = useCallback(async (): Promise<void> => {
    if (!sessionId || !openedPath || saveStatus === 'saving') return;
    const currentContent = editorRef.current?.getValue() ?? content;
    setSaveStatus('saving');
    try {
      const r = await fetch(`/api/session/${sessionId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: openedPath, content: currentContent, container }),
      });
      const data = await r.json() as { error?: string };
      if (!r.ok) throw new Error(data.error || r.statusText);
      setSaveStatus('saved');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveStatus('idle'), 2500);
    } catch (_e: unknown) {
      setSaveStatus('error');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveStatus('idle'), 3500);
    }
  }, [sessionId, openedPath, container, content, saveStatus]);

  function handlePathKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') openFile(pathInput, container);
  }

  const hasFile = Boolean(openedPath);

  return (
    <div className="code-editor-root">
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
