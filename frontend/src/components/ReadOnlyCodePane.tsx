import React, { useMemo } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import type * as Monaco from 'monaco-editor';

loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' } });

const THEME_NAME = 'devlabs-solution-dark';

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
      'editor.background': '#0a0a0a',
      'editor.foreground': '#eef0ff',
      'editor.lineHighlightBackground': '#0a0a0a',
      'editor.selectionBackground': '#222222',
      'editor.inactiveSelectionBackground': '#1a1a1a',
      'editorCursor.foreground': '#34d399',
      'editorLineNumber.foreground': '#444444',
      'editorLineNumber.activeForeground': '#888888',
      'editorIndentGuide.background': '#1a1a1a',
      'editorIndentGuide.activeBackground': '#333333',
      // Monaco expects #RRGGBBAA — rgba() falls back to a harsh default (looks red).
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': '#FFFFFF1A',
      'scrollbarSlider.hoverBackground': '#FFFFFF33',
      'scrollbarSlider.activeBackground': '#FFFFFF40',
    },
  });
}

function detectLanguage(filePath: string): string {
  const base = filePath.split('/').pop() ?? '';
  if (/^dockerfile$/i.test(base)) return 'dockerfile';
  const ext = (base.split('.').pop() ?? '').toLowerCase();
  if (ext === 'py') return 'python';
  if (ext === 'md') return 'markdown';
  if (ext === 'json') return 'json';
  if (ext === 'yml' || ext === 'yaml') return 'yaml';
  if (ext === 'sh' || ext === 'bash') return 'shell';
  if (ext === 'sql') return 'sql';
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'js' || ext === 'jsx') return 'javascript';
  if (ext === 'csv') return 'csv';
  return 'plaintext';
}

let csvLanguageRegistered = false;

function ensureCsvLanguage(monaco: typeof Monaco): void {
  if (csvLanguageRegistered) return;
  csvLanguageRegistered = true;
  monaco.languages.register({ id: 'csv' });
  monaco.languages.setMonarchTokensProvider('csv', {
    defaultToken: 'string',
    tokenizer: {
      root: [
        [/^(date,cabin,snack,status,cents).*$/, 'type'],
        [/\b(successful|failed|paid|refund)\b/, 'keyword'],
        [/\d{4}-\d{2}-\d{2}/, 'number'],
        [/,(\s*)(\d{2,})\b/, 'number'],
        [/[,]/, 'operator'],
        [/[^,\n]+/, 'string'],
      ],
    },
  });
}

const LINE_HEIGHT_PX = 18;
const EDITOR_PAD_PX = 20; // Monaco padding top + bottom

function lineCount(content: string): number {
  const trimmed = content.replace(/\n+$/g, '');
  return Math.max(1, trimmed.length === 0 ? 1 : trimmed.split('\n').length);
}

/** Height from source lines — no Monaco getContentHeight (avoids empty tails / collapsed panes). */
function heightForContent(content: string, capped = true): number {
  const height = lineCount(content) * LINE_HEIGHT_PX + EDITOR_PAD_PX;
  // Capped panes keep a one-line buffer so the last row is not clipped by chrome.
  return capped ? Math.min(480, height + LINE_HEIGHT_PX) : height;
}

interface ReadOnlyCodePaneProps {
  path: string;
  content: string;
  className?: string;
  /** Fill parent height instead of sizing to content. */
  fill?: boolean;
  /** Grow to full content height (no 480px cap / no vertical scroll). */
  expand?: boolean;
  /** Override language detection from path (e.g. markdown fences). */
  language?: string;
}

export default function ReadOnlyCodePane({
  path,
  content,
  className,
  fill = false,
  expand = false,
  language: languageProp,
}: ReadOnlyCodePaneProps): JSX.Element {
  const language = useMemo(
    () => languageProp || detectLanguage(path),
    [languageProp, path],
  );
  const height = useMemo(
    () => (fill ? undefined : heightForContent(content, !expand)),
    [content, fill, expand],
  );

  function handleMount(editor: MonacoEditorNS.IStandaloneCodeEditor, monaco: typeof Monaco): void {
    ensureCsvLanguage(monaco);
    defineTheme(monaco);
    monaco.editor.setTheme(THEME_NAME);
    editor.updateOptions({
      readOnly: true,
      domReadOnly: true,
    });
  }

  return (
    <div
      className={`readonly-code-pane${fill ? ' readonly-code-pane--fill' : ''}${className ? ` ${className}` : ''}`}
      style={fill ? undefined : { height }}
    >
      <MonacoEditor
        height="100%"
        language={language}
        value={content}
        theme={THEME_NAME}
        onMount={handleMount}
        loading={
          <pre className="readonly-code-pane-fallback">
            <code>{content}</code>
          </pre>
        }
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'off',
          lineNumbers: 'on',
          glyphMargin: false,
          folding: false,
          renderLineHighlight: 'none',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          scrollbar: {
            vertical: expand ? 'hidden' : 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: expand ? 0 : 8,
            horizontalScrollbarSize: 8,
            alwaysConsumeMouseWheel: false,
          },
          fontSize: 12,
          lineHeight: LINE_HEIGHT_PX,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          padding: { top: 10, bottom: 10 },
          contextmenu: false,
          automaticLayout: true,
          tabSize: 4,
        }}
      />
    </div>
  );
}
