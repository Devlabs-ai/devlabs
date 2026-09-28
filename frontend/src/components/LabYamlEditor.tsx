import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { tags as t } from '@lezer/highlight';

interface LabYamlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Focus the editor when this flips to true (e.g. tab becomes visible). */
  active?: boolean;
  placeholder?: string;
  onSave?: () => void;
}

const labTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: '#000',
      color: '#eef0ff',
      fontSize: '13px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      lineHeight: '1.55',
    },
    '.cm-content': { padding: '12px 0', caretColor: '#34d399' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#34d399' },
    '.cm-gutters': {
      backgroundColor: '#000',
      color: '#444',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: '#0a0a0a' },
    '.cm-activeLineGutter': { backgroundColor: '#0a0a0a', color: '#888' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(52, 211, 153, 0.22)',
    },
    '.cm-matchingBracket': { backgroundColor: 'rgba(52, 211, 153, 0.18)', outline: 'none' },
    '.cm-placeholder': { color: '#4a5273', fontStyle: 'italic' },
  },
  { dark: true },
);

const labHighlight = HighlightStyle.define([
  { tag: t.comment, color: '#4a5273', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: '#6ee7b7' },
  { tag: [t.number, t.bool, t.null], color: '#fb923c' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: '#93c5fd' },
  { tag: [t.keyword, t.typeName], color: '#38bdf8' },
  { tag: [t.punctuation, t.separator], color: '#8a8fa8' },
]);

export default function LabYamlEditor({
  value,
  onChange,
  active = true,
  placeholder,
  onSave,
}: LabYamlEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          indentUnit.of('  '),
          EditorState.tabSize.of(2),
          EditorView.lineWrapping,
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          yaml(),
          syntaxHighlighting(labHighlight),
          labTheme,
          placeholder ? placeholderExt(placeholder) : [],
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; external value changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    if (!active) return undefined;
    const id = window.requestAnimationFrame(() => viewRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [active]);

  return <div ref={hostRef} className="lab-yaml-editor" />;
}
