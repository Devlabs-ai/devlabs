import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReadingTrackId } from '../constants/readingTracks';
import {
  countReadingCuration,
  loadReadingCuration,
  saveReadingCuration,
  type ReadingCurationEntry,
  type ReadingCurationState,
} from '../services/readingCurationStorage';

type ReadingCurationContextValue = {
  isAdmin: boolean;
  mode: boolean;
  setMode: (on: boolean) => void;
  /** When true, inline admin note text is hidden (editors still work). */
  notesCollapsed: boolean;
  setNotesCollapsed: (collapsed: boolean) => void;
  getEntry: (blockId: string) => ReadingCurationEntry | undefined;
  setNote: (blockId: string, note: string) => void;
  clearBlock: (blockId: string) => void;
  editingNoteBlockId: string | null;
  openNoteEditor: (blockId: string) => void;
  closeNoteEditor: () => void;
  counts: { notes: number };
  readingPrefix: string;
};

const ReadingCurationContext = createContext<ReadingCurationContextValue | null>(null);

function emptyEntry(): ReadingCurationEntry {
  return { note: '', updatedAt: new Date().toISOString() };
}

function mergeEntry(
  prev: ReadingCurationEntry | undefined,
  patch: Partial<ReadingCurationEntry>,
): ReadingCurationEntry {
  const base = prev ?? emptyEntry();
  return {
    ...base,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

export function readingCurationBlockId(readingPrefix: string, ...parts: string[]): string {
  return [readingPrefix, ...parts].join('/');
}

export function ReadingCurationProvider({
  trackId,
  readingSlug,
  isAdmin,
  children,
}: {
  trackId: ReadingTrackId;
  readingSlug: string;
  isAdmin: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const readingPrefix = `${trackId}/${readingSlug}`;
  const [state, setState] = useState<ReadingCurationState>(() =>
    isAdmin ? loadReadingCuration(trackId, readingSlug) : {},
  );
  const [mode, setMode] = useState(false);
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [editingNoteBlockId, setEditingNoteBlockId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    setState(loadReadingCuration(trackId, readingSlug));
    setMode(false);
    setNotesCollapsed(false);
    setEditingNoteBlockId(null);
  }, [isAdmin, trackId, readingSlug]);

  const persist = useCallback(
    (next: ReadingCurationState) => {
      setState(next);
      if (isAdmin) saveReadingCuration(trackId, readingSlug, next);
    },
    [isAdmin, trackId, readingSlug],
  );

  const getEntry = useCallback(
    (blockId: string) => state[blockId],
    [state],
  );

  const setNote = useCallback(
    (blockId: string, note: string) => {
      const trimmed = note.trim();
      if (!trimmed) {
        const next = { ...state };
        delete next[blockId];
        persist(next);
        return;
      }
      persist({
        ...state,
        [blockId]: mergeEntry(state[blockId], { note: trimmed }),
      });
    },
    [persist, state],
  );

  const clearBlock = useCallback(
    (blockId: string) => {
      const next = { ...state };
      delete next[blockId];
      persist(next);
    },
    [persist, state],
  );

  const counts = useMemo(() => countReadingCuration(state), [state]);

  const value = useMemo<ReadingCurationContextValue>(
    () => ({
      isAdmin,
      mode,
      setMode,
      notesCollapsed,
      setNotesCollapsed,
      getEntry,
      setNote,
      clearBlock,
      editingNoteBlockId,
      openNoteEditor: setEditingNoteBlockId,
      closeNoteEditor: () => setEditingNoteBlockId(null),
      counts,
      readingPrefix,
    }),
    [
      isAdmin,
      mode,
      notesCollapsed,
      getEntry,
      setNote,
      clearBlock,
      editingNoteBlockId,
      counts,
      readingPrefix,
    ],
  );

  return (
    <ReadingCurationContext.Provider value={value}>{children}</ReadingCurationContext.Provider>
  );
}

function useReadingCurationOptional(): ReadingCurationContextValue | null {
  return useContext(ReadingCurationContext);
}

function NoteEditor({
  blockId,
  initialNote,
  onSave,
  onClear,
  onClose,
}: {
  blockId: string;
  initialNote: string;
  onSave: (text: string) => void;
  onClear: () => void;
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState(initialNote);

  useEffect(() => {
    setDraft(initialNote);
  }, [blockId, initialNote]);

  return (
    <div className="reading-curation-note-editor" role="form" aria-label="Admin curation note">
      <label className="reading-curation-note-editor-label" htmlFor={`curation-note-${blockId}`}>
        Admin note
      </label>
      <textarea
        id={`curation-note-${blockId}`}
        className="reading-curation-note-editor-input"
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Flow check, rewrite idea, fact-check…"
      />
      <div className="reading-curation-note-editor-actions">
        <button type="button" className="primary" onClick={() => onSave(draft)}>
          Save note
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        {initialNote.trim() || draft.trim() ? (
          <button
            type="button"
            className="ghost reading-curation-note-editor-clear"
            onClick={() => {
              onClear();
              onClose();
            }}
          >
            Remove note
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ReadingCurationToolbar(): JSX.Element | null {
  const curation = useReadingCurationOptional();
  if (!curation?.isAdmin) return null;

  const { mode, setMode, counts, notesCollapsed, setNotesCollapsed } = curation;
  const summary =
    counts.notes > 0
      ? `${counts.notes} note${counts.notes === 1 ? '' : 's'}${notesCollapsed ? ' (hidden)' : ''}`
      : 'No notes yet';

  return (
    <aside className="reading-curation-toolbar" aria-label="Admin content curation">
      <div className="reading-curation-toolbar-main">
        <span className="reading-curation-toolbar-badge">Admin</span>
        <span className="reading-curation-toolbar-title">Content curation</span>
        <span className="reading-curation-toolbar-meta">{summary}</span>
      </div>
      <div className="reading-curation-toolbar-controls">
        <label className="reading-curation-toolbar-toggle">
          <input
            type="checkbox"
            checked={mode}
            onChange={(e) => setMode(e.target.checked)}
          />
          <span>Edit mode</span>
        </label>
        {counts.notes > 0 ? (
          <button
            type="button"
            className="reading-curation-toolbar-btn"
            aria-pressed={notesCollapsed}
            onClick={() => setNotesCollapsed(!notesCollapsed)}
          >
            {notesCollapsed ? 'Show all notes' : 'Hide all notes'}
          </button>
        ) : null}
      </div>
      <p className="reading-curation-toolbar-hint">
        {mode
          ? 'Add notes on blocks while you sanity-check flow. Saved in this browser only.'
          : notesCollapsed
            ? 'Notes are hidden. Use “Show all notes” to read them, or turn on edit mode to change them.'
            : 'Turn on edit mode to add notes. Notes stay visible for admins.'}
      </p>
    </aside>
  );
}

export function ReadingCurationBlock({
  blockId,
  className,
  as: Tag = 'div',
  children,
}: {
  blockId: string;
  className?: string;
  /** Use `li` inside `ul` lists so markup stays valid. */
  as?: 'div' | 'li';
  children: React.ReactNode;
}): JSX.Element {
  const curation = useReadingCurationOptional();
  if (!curation?.isAdmin) {
    return Tag === 'li' ? <li className={className}>{children}</li> : <>{children}</>;
  }

  const entry = curation.getEntry(blockId);
  const note = entry?.note?.trim() ?? '';
  const showNote = Boolean(note);
  const editing = curation.editingNoteBlockId === blockId;
  const editable = curation.mode;

  const showNotePanel = showNote && !curation.notesCollapsed;

  const blockClass = [
    'reading-curation-block',
    showNotePanel ? 'reading-curation-block--noted' : '',
    showNote && curation.notesCollapsed ? 'reading-curation-block--noted-collapsed' : '',
    editable ? 'reading-curation-block--editable' : '',
    Tag === 'li' ? 'reading-curation-block--li' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag className={blockClass} data-curation-block={blockId}>
      {editable ? (
        <div className="reading-curation-block-actions">
          <button
            type="button"
            className={`reading-curation-action${showNote ? ' is-on' : ''}`}
            onClick={() => curation.openNoteEditor(blockId)}
          >
            {showNote ? 'Edit note' : 'Add note'}
          </button>
        </div>
      ) : null}
      <div className="reading-curation-block-body">{children}</div>
      {showNotePanel && !editing ? (
        <div className="reading-curation-note">
          <span className="reading-curation-note-label">Admin note</span>
          <p>{note}</p>
        </div>
      ) : null}
      {editing ? (
        <NoteEditor
          blockId={blockId}
          initialNote={entry?.note ?? ''}
          onSave={(text) => {
            curation.setNote(blockId, text);
            curation.closeNoteEditor();
          }}
          onClear={() => curation.clearBlock(blockId)}
          onClose={() => curation.closeNoteEditor()}
        />
      ) : null}
    </Tag>
  );
}
