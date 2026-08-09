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
  return 'plaintext';
}

const LINE_HEIGHT_PX = 18;
const EDITOR_PAD_PX = 20; // Monaco padding top + bottom
const ONE_LINE_PAD_PX = LINE_HEIGHT_PX;

function heightForContent(content: string): number {
  // Ignore trailing newlines so a single-line snippet doesn't reserve an empty row.
  const trimmed = content.replace(/\n+$/g, '');
  const lines = Math.max(1, trimmed.length === 0 ? 1 : trimmed.split('\n').length);
  return Math.min(480, lines * LINE_HEIGHT_PX + EDITOR_PAD_PX + ONE_LINE_PAD_PX);
}

interface ReadOnlyCodePaneProps {
  path: string;
  content: string;
  className?: string;
  /** Fill parent height instead of sizing to content. */
  fill?: boolean;
  /** Override language detection from path (e.g. markdown fences). */
  language?: string;
}

export default function ReadOnlyCodePane({
  path,
  content,
  className,
  fill = false,
  language: languageProp,
}: ReadOnlyCodePaneProps): JSX.Element {
  const language = useMemo(
    () => languageProp || detectLanguage(path),
    [languageProp, path],
  );
  const height = useMemo(
    () => (fill ? undefined : heightForContent(content)),
    [content, fill],
  );

  function handleMount(editor: MonacoEditorNS.IStandaloneCodeEditor, monaco: typeof Monaco): void {
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
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          lineNumbers: 'on',
          glyphMargin: false,
          folding: true,
          renderLineHighlight: 'none',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
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
