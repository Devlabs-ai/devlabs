import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import LabYamlEditor from './LabYamlEditor';
import { IconFolderOpen } from './ChromeIcons';
import {
  createK8sFolder,
  deleteK8sFile,
  deleteK8sFolder,
  listK8sDir,
  listK8sFolders,
  readK8sFile,
  renameK8sEntry,
  saveK8sFile,
  type K8sLabDirListing,
} from '../services/workspaceApi';

interface K8sLabFileEditorProps {
  sessionId: string;
  challengeId: string;
  labReady: boolean;
  /** Editor tab is visible. */
  active: boolean;
  toggleHint: string;
}

type FileBuf = {
  /** Relative to the lab home, e.g. "manifests/web.yaml". */
  path: string;
  /** null until fetched from the lab home. */
  content: string | null;
  /** Last content known to be on disk; null when never saved / not fetched. */
  saved: string | null;
  onDisk: boolean;
  updatedAt: number | null;
};

/** An explorer row; "unsaved" is a new file that only exists in the editor so far. */
type EntryRef = { kind: 'file' | 'folder' | 'unsaved'; path: string };

/** Mirrors backend/workspace/k8sLabFiles.ts. */
const SEGMENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;
const MAX_DEPTH = 6;
const DEFAULT_NAME = 'untitled.yaml';
const DRAFT_KEY_PREFIX = 'devsetu.k8sLab.drafts.v2.';
const DIR_KEY_PREFIX = 'devsetu.k8sLab.dir.v1.';
const AUTOSAVE_MS = 700;
const AUTOSAVE_RETRY_MS = 3000;

function isDirty(b: FileBuf): boolean {
  return b.content !== null && b.content !== (b.saved ?? '');
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

function displayDir(dir: string): string {
  return dir ? `~/${dir}` : '~';
}

/** "~/a/b/", "/a/b", "a/b" → "a/b"; null when a segment is not allowed. */
function normalizeRel(raw: string): string | null {
  const trimmed = raw.trim().replace(/^~(\/|$)/, '').replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length > MAX_DEPTH || !parts.every((s) => SEGMENT_RE.test(s))) return null;
  return parts.join('/');
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function loadDrafts(challengeId: string): FileBuf[] {
  try {
    const raw = readSession(`${DRAFT_KEY_PREFIX}${challengeId || 'lab'}`);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return Object.entries(parsed)
      .filter(([p, content]) => typeof content === 'string' && normalizeRel(p) === p && p !== '')
      .map(([p, content]) => ({ path: p, content: content as string, saved: null, onDisk: false, updatedAt: null }));
  } catch {
    return [];
  }
}

function errorMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err?.response?.data?.error || err?.message || fallback;
}

function isNotFound(e: unknown): boolean {
  return (e as { response?: { status?: number } })?.response?.status === 404;
}

function nextUntitledPath(dir: string, taken: Set<string>): string {
  const first = joinPath(dir, DEFAULT_NAME);
  if (!taken.has(first)) return first;
  for (let i = 1; ; i += 1) {
    const p = joinPath(dir, `untitled-${i}.yaml`);
    if (!taken.has(p)) return p;
  }
}

export default function K8sLabFileEditor({
  sessionId,
  challengeId,
  labReady,
  active,
  toggleHint,
}: K8sLabFileEditorProps): JSX.Element {
  const canUseApi = labReady && Boolean(sessionId) && !sessionId.startsWith('pending-k8s-');
  const folderListId = useId();
  const dirKey = `${DIR_KEY_PREFIX}${challengeId || 'lab'}`;

  const [bufs, setBufs] = useState<FileBuf[]>(() => loadDrafts(challengeId));
  const bufsRef = useRef(bufs);
  bufsRef.current = bufs;
  const [activePath, setActivePath] = useState<string | null>(() => bufs[0]?.path ?? null);

  const [explorerOpen, setExplorerOpen] = useState(false);
  const [dir, setDir] = useState<string>(() => normalizeRel(readSession(dirKey) || '') ?? '');
  const [pathInput, setPathInput] = useState(() => displayDir(dir));
  const [listing, setListing] = useState<K8sLabDirListing | null>(null);
  const [dirMissing, setDirMissing] = useState(false);
  const [allFolders, setAllFolders] = useState<string[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderValue, setNewFolderValue] = useState('');

  const [renaming, setRenaming] = useState<EntryRef | null>(null);
  const [menu, setMenu] = useState<(EntryRef & { x: number; y: number }) | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renamingRef = useRef<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const inFlightRef = useRef<Set<string>>(new Set());
  const failingRef = useRef(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const current = bufs.find((b) => b.path === activePath) || null;

  const flash = useCallback((kind: 'ok' | 'error', text: string) => {
    setNotice({ kind, text });
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const id = window.setTimeout(() => setNotice(null), notice.kind === 'ok' ? 1800 : 4500);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    try {
      sessionStorage.setItem(dirKey, dir);
    } catch {
      /* quota */
    }
    setPathInput(displayDir(dir));
  }, [dir, dirKey]);

  /** Re-list the open folder plus every folder with an open file, then reconcile buffers. */
  const refresh = useCallback(async () => {
    if (!canUseApi) return;
    const dirs = Array.from(new Set([dir, '', ...bufsRef.current.map((b) => dirname(b.path))]));
    let results: Array<K8sLabDirListing | null>;
    try {
      results = await Promise.all(dirs.map((d) => listK8sDir(sessionId, d).catch((e) => {
        if (isNotFound(e)) return null;
        throw e;
      })));
      setAllFolders(await listK8sFolders(sessionId));
    } catch (e) {
      flash('error', errorMessage(e, 'Could not load files'));
      return;
    }
    const byDir = new Map(dirs.map((d, i) => [d, results[i]]));
    const openListing = byDir.get(dir) ?? null;
    setListing(openListing);
    setDirMissing(openListing === null);
    const diskByPath = new Map<string, { updatedAt: number }>();
    for (const l of results) for (const f of l?.files || []) diskByPath.set(f.path, f);

    setBufs((prev) => {
      const next: FileBuf[] = [];
      for (const b of prev) {
        const disk = diskByPath.get(b.path);
        const dirty = isDirty(b);
        if (!disk) {
          // Removed from the terminal: drop it unless there are unsaved edits.
          if (b.onDisk && !dirty) continue;
          next.push({ ...b, onDisk: false, saved: b.onDisk ? null : b.saved });
        } else if (!dirty && b.updatedAt !== disk.updatedAt) {
          // Changed on disk (e.g. edited with vi): reload.
          next.push({ ...b, onDisk: true, content: null, saved: null, updatedAt: disk.updatedAt });
        } else {
          next.push({ ...b, onDisk: true, updatedAt: disk.updatedAt });
        }
      }
      return next;
    });
  }, [canUseApi, sessionId, dir, flash]);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  useEffect(() => {
    if (activePath && bufs.some((b) => b.path === activePath)) return;
    setActivePath(bufs[0]?.path ?? null);
  }, [bufs, activePath]);

  const needsFetch = Boolean(
    canUseApi && current?.onDisk && (current.content === null || current.saved === null),
  );
  useEffect(() => {
    if (!needsFetch || !current) return undefined;
    const p = current.path;
    let cancelled = false;
    readK8sFile(sessionId, p)
      .then((disk) => {
        if (cancelled) return;
        setBufs((prev) => prev.map((b) => (
          b.path === p ? { ...b, saved: disk, content: b.content === null ? disk : b.content } : b
        )));
      })
      .catch((e) => {
        if (!cancelled) flash('error', errorMessage(e, `Could not open ~/${p}`));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFetch, current?.path, sessionId]);

  useEffect(() => {
    const drafts: Record<string, string> = {};
    for (const b of bufs) {
      if (isDirty(b) && b.content !== null) drafts[b.path] = b.content;
    }
    const key = `${DRAFT_KEY_PREFIX}${challengeId || 'lab'}`;
    try {
      if (Object.keys(drafts).length > 0) sessionStorage.setItem(key, JSON.stringify(drafts));
      else sessionStorage.removeItem(key);
    } catch {
      /* quota */
    }
  }, [bufs, challengeId]);

  const anyDirty = bufs.some(isDirty);
  useEffect(() => {
    if (!anyDirty) return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyDirty]);

  const openDir = (raw: string) => {
    const next = normalizeRel(raw);
    if (next === null) {
      flash('error', 'Folder names may use letters, digits, ".", "_" and "-" (no leading dot).');
      return;
    }
    setNewFolderOpen(false);
    setDir(next);
  };

  const openExplorerAtHome = () => {
    setDir('');
    setExplorerOpen(true);
  };

  const openFile = (p: string, updatedAt: number | null = null) => {
    if (!bufs.some((b) => b.path === p)) {
      setBufs((prev) => [...prev, { path: p, content: null, saved: null, onDisk: true, updatedAt }]);
    }
    setActivePath(p);
  };

  const updateContent = (p: string, content: string) => {
    setBufs((prev) => prev.map((b) => (b.path === p ? { ...b, content } : b)));
  };

  const saveBuffer = useCallback(async (p: string) => {
    const b = bufsRef.current.find((x) => x.path === p);
    if (!canUseApi || !b || b.content === null || !isDirty(b) || inFlightRef.current.has(p)) return;
    const content = b.content;
    inFlightRef.current.add(p);
    setSaveState('saving');
    try {
      const file = await saveK8sFile(sessionId, p, content);
      setBufs((prev) => prev.map((x) => (
        x.path === p ? { ...x, saved: content, onDisk: true, updatedAt: file.updatedAt } : x
      )));
      failingRef.current = false;
      setSaveState('saved');
      if (!b.onDisk) void refresh();
    } catch (e) {
      if (!failingRef.current) flash('error', errorMessage(e, `Could not save ~/${p}`));
      failingRef.current = true;
      setSaveState('error');
    } finally {
      inFlightRef.current.delete(p);
    }
  }, [canUseApi, sessionId, refresh, flash]);

  const saveAllDirty = useCallback(() => {
    for (const b of bufsRef.current) {
      if (isDirty(b) && renamingRef.current !== b.path) void saveBuffer(b.path);
    }
  }, [saveBuffer]);

  // Autosave: debounce after the last edit; each keystroke restarts the timer.
  useEffect(() => {
    if (!canUseApi || !bufs.some(isDirty)) return undefined;
    const id = window.setTimeout(saveAllDirty, AUTOSAVE_MS);
    return () => window.clearTimeout(id);
  }, [bufs, canUseApi, renaming, saveAllDirty]);

  useEffect(() => {
    if (saveState !== 'error' || !canUseApi) return undefined;
    const id = window.setTimeout(saveAllDirty, AUTOSAVE_RETRY_MS);
    return () => window.clearTimeout(id);
  }, [saveState, canUseApi, saveAllDirty]);

  // Flush right away when switching to the terminal so `kubectl apply` sees the latest text.
  useEffect(() => {
    if (!active) saveAllDirty();
  }, [active, saveAllDirty]);

  const startRename = (target: EntryRef) => {
    setMenu(null);
    renamingRef.current = target.path;
    setRenaming(target);
    setRenameValue(basename(target.path));
  };

  const cancelRename = () => {
    renamingRef.current = null;
    setRenaming(null);
  };

  const newFile = () => {
    const taken = new Set([
      ...bufs.map((b) => b.path),
      ...(listing?.files.map((f) => f.path) || []),
    ]);
    const p = nextUntitledPath(dir, taken);
    setBufs((prev) => [...prev, { path: p, content: '', saved: null, onDisk: false, updatedAt: null }]);
    setActivePath(p);
    setExplorerOpen(true);
    startRename({ kind: 'unsaved', path: p });
  };

  const commitRename = async (requested: EntryRef, raw: string) => {
    if (renamingRef.current !== requested.path) return;
    cancelRename();
    const nowOnDisk = requested.kind === 'unsaved'
      && bufsRef.current.some((b) => b.path === requested.path && b.onDisk);
    const target: EntryRef = nowOnDisk ? { kind: 'file', path: requested.path } : requested;
    const from = target.path;
    const rel = normalizeRel(raw);
    if (rel === null || rel === '') {
      if (raw.trim()) flash('error', 'Use letters, digits, ".", "_" or "-" (no leading dot).');
      return;
    }
    const to = joinPath(dirname(from), rel);
    if (to === from) return;

    if (target.kind === 'unsaved') {
      if (bufs.some((b) => b.path === to)) {
        flash('error', `~/${to} is already open`);
        return;
      }
      setBufs((prev) => prev.map((x) => (x.path === from ? { ...x, path: to } : x)));
      setActivePath((cur) => (cur === from ? to : cur));
      return;
    }

    if (!canUseApi) {
      flash('error', 'Renaming unlocks once your cluster is ready.');
      return;
    }
    try {
      await renameK8sEntry(sessionId, from, to);
    } catch (e) {
      flash('error', errorMessage(e, `Could not rename ~/${from}`));
      return;
    }
    const moveUnder = (p: string): string => {
      if (p === from) return to;
      if (target.kind === 'folder' && p.startsWith(`${from}/`)) return `${to}${p.slice(from.length)}`;
      return p;
    };
    setBufs((prev) => prev.map((x) => ({ ...x, path: moveUnder(x.path) })));
    setActivePath((cur) => (cur ? moveUnder(cur) : cur));
    if (target.kind === 'folder') setDir((d) => moveUnder(d));
    void refresh();
  };

  const closeTab = (p: string) => {
    const b = bufs.find((x) => x.path === p);
    if (!b) return;
    if (isDirty(b) && !window.confirm(`Discard unsaved changes to ~/${p}?`)) return;
    setBufs((prev) => prev.filter((x) => x.path !== p));
  };

  const deleteEntry = async (target: EntryRef) => {
    setMenu(null);
    const p = target.path;
    if (target.kind === 'unsaved') {
      const b = bufs.find((x) => x.path === p);
      if (b?.content && !window.confirm(`Discard unsaved ~/${p}?`)) return;
      setBufs((prev) => prev.filter((x) => x.path !== p));
      return;
    }
    const prompt = target.kind === 'folder'
      ? `Delete ~/${p} and everything inside it? This cannot be undone.`
      : `Delete ~/${p}? This cannot be undone.`;
    if (!window.confirm(prompt)) return;
    try {
      if (target.kind === 'folder') await deleteK8sFolder(sessionId, p);
      else await deleteK8sFile(sessionId, p);
    } catch (e) {
      if (!isNotFound(e)) {
        flash('error', errorMessage(e, `Could not delete ~/${p}`));
        return;
      }
    }
    const gone = (x: string) => x === p || (target.kind === 'folder' && x.startsWith(`${p}/`));
    setBufs((prev) => prev.filter((x) => !gone(x.path)));
    if (target.kind === 'folder' && gone(dir)) setDir(dirname(p));
    flash('ok', `Deleted ~/${p}`);
    void refresh();
  };

  const openMenu = (e: React.MouseEvent, target: EntryRef) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ ...target, x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const createFolder = async (raw: string) => {
    setNewFolderOpen(false);
    const rel = normalizeRel(raw);
    if (rel === null || rel === '') {
      if (raw.trim()) flash('error', 'Folder names may use letters, digits, ".", "_" and "-" (no leading dot).');
      return;
    }
    const target = joinPath(dir, rel);
    try {
      await createK8sFolder(sessionId, target);
      setDir(target);
    } catch (e) {
      flash('error', errorMessage(e, `Could not create ~/${target}`));
    }
  };

  const createCurrentDir = async () => {
    try {
      await createK8sFolder(sessionId, dir);
      void refresh();
    } catch (e) {
      flash('error', errorMessage(e, `Could not create ${displayDir(dir)}`));
    }
  };

  const isRenaming = (t: EntryRef) => renaming?.path === t.path && renaming.kind === t.kind;
  const isMenuFor = (t: EntryRef) => menu?.path === t.path && menu.kind === t.kind;

  const renameInput = (target: EntryRef) => (
    <input
      className="k8s-files-rename k8s-explorer-rename"
      value={renameValue}
      autoFocus
      spellCheck={false}
      aria-label={`Rename ${basename(target.path)}`}
      onChange={(e) => setRenameValue(e.target.value)}
      onFocus={(e) => {
        const dot = target.kind === 'folder' ? -1 : e.target.value.lastIndexOf('.');
        e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') void commitRename(target, renameValue);
        if (e.key === 'Escape') cancelRename();
      }}
      onBlur={() => void commitRename(target, renameValue)}
    />
  );

  const unsavedHere = bufs.filter((b) => !b.onDisk && dirname(b.path) === dir);
  let autosaveLabel = '';
  let autosaveTone: 'pending' | 'ok' | 'error' = 'pending';
  if (anyDirty && !canUseApi) {
    autosaveLabel = 'Saves when cluster is ready';
  } else if (saveState === 'error' && anyDirty) {
    autosaveLabel = 'Not saved — retrying';
    autosaveTone = 'error';
  } else if (anyDirty || saveState === 'saving') {
    autosaveLabel = 'Saving…';
  } else if (saveState === 'saved') {
    autosaveLabel = 'Saved';
    autosaveTone = 'ok';
  }

  return (
    <div className="k8s-files-layout">
      <div
        className={`k8s-explorer-backdrop${explorerOpen ? ' is-open' : ''}`}
        onClick={() => setExplorerOpen(false)}
        aria-hidden
      />
      <aside
        className={`k8s-explorer${explorerOpen ? ' is-open' : ''}`}
        aria-label="Files"
        aria-hidden={!explorerOpen}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !newFolderOpen) setExplorerOpen(false);
        }}
      >
        <form
          className="k8s-explorer-path"
          onSubmit={(e) => {
            e.preventDefault();
            openDir(pathInput);
          }}
        >
          <input
            list={folderListId}
            value={pathInput}
            spellCheck={false}
            placeholder="~/folder"
            aria-label="Folder path"
            disabled={!canUseApi}
            onChange={(e) => {
              const v = e.target.value;
              setPathInput(v);
              const rel = normalizeRel(v);
              // Picking an entry from the dropdown opens it straight away.
              if (rel !== null && rel !== dir && (rel === '' ? v.trim() === '~' : allFolders.includes(rel))) {
                setDir(rel);
              }
            }}
            onFocus={(e) => e.target.select()}
          />
          <datalist id={folderListId}>
            <option value="~" />
            {allFolders.map((f) => <option key={f} value={`~/${f}`} />)}
          </datalist>
          <button
            type="button"
            className="k8s-explorer-close"
            onClick={() => setExplorerOpen(false)}
            title="Close explorer"
            aria-label="Close explorer"
          >
            ×
          </button>
        </form>

        <div className="k8s-explorer-toolbar">
          <span className="k8s-explorer-dir" title={displayDir(dir)}>{displayDir(dir)}</span>
          <button type="button" className="k8s-explorer-icon" onClick={newFile} title="New file" aria-label="New file">
            + File
          </button>
          <button
            type="button"
            className="k8s-explorer-icon"
            disabled={!canUseApi || dirMissing}
            onClick={() => {
              setNewFolderValue('');
              setNewFolderOpen(true);
            }}
            title="New folder"
            aria-label="New folder"
          >
            + Folder
          </button>
          <button
            type="button"
            className="k8s-explorer-icon"
            disabled={!canUseApi}
            onClick={() => void refresh()}
            title="Refresh"
            aria-label="Refresh"
          >
            ↻
          </button>
        </div>

        <ul className="k8s-explorer-list">
          {newFolderOpen && (
            <li>
              <input
                className="k8s-files-rename k8s-explorer-new-folder"
                value={newFolderValue}
                autoFocus
                spellCheck={false}
                placeholder="folder-name"
                aria-label="New folder name"
                onChange={(e) => setNewFolderValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createFolder(newFolderValue);
                  if (e.key === 'Escape') setNewFolderOpen(false);
                }}
                onBlur={() => setNewFolderOpen(false)}
              />
            </li>
          )}
          {dir && (
            <li>
              <button type="button" className="k8s-explorer-row is-folder" onClick={() => setDir(dirname(dir))}>
                <span className="k8s-explorer-glyph" aria-hidden>↰</span>
                <span className="k8s-explorer-name">..</span>
              </button>
            </li>
          )}
          {listing?.folders.map((name) => {
            const target: EntryRef = { kind: 'folder', path: joinPath(dir, name) };
            return (
              <li key={`d:${name}`}>
                {isRenaming(target) ? renameInput(target) : (
                  <button
                    type="button"
                    className={`k8s-explorer-row is-folder${isMenuFor(target) ? ' is-menu' : ''}`}
                    onClick={() => setDir(target.path)}
                    onContextMenu={(e) => openMenu(e, target)}
                    title={`~/${target.path} — right-click to rename or delete`}
                  >
                    <span className="k8s-explorer-glyph" aria-hidden>▸</span>
                    <span className="k8s-explorer-name">{name}/</span>
                  </button>
                )}
              </li>
            );
          })}
          {listing?.files.map((f) => {
            const target: EntryRef = { kind: 'file', path: f.path };
            return (
              <li key={`f:${f.path}`}>
                {isRenaming(target) ? renameInput(target) : (
                  <button
                    type="button"
                    className={`k8s-explorer-row${f.path === activePath ? ' is-active' : ''}${isMenuFor(target) ? ' is-menu' : ''}`}
                    onClick={() => openFile(f.path, f.updatedAt)}
                    onContextMenu={(e) => openMenu(e, target)}
                    title={`~/${f.path} — right-click to rename or delete`}
                  >
                    <span className="k8s-explorer-glyph" aria-hidden>·</span>
                    <span className="k8s-explorer-name">{f.name}</span>
                    {bufs.some((b) => b.path === f.path && isDirty(b)) ? (
                      <span className="k8s-files-dirty" aria-label="unsaved changes" />
                    ) : null}
                  </button>
                )}
              </li>
            );
          })}
          {unsavedHere.map((b) => {
            const target: EntryRef = { kind: 'unsaved', path: b.path };
            return (
              <li key={`u:${b.path}`}>
                {isRenaming(target) ? renameInput(target) : (
                  <button
                    type="button"
                    className={`k8s-explorer-row is-new${b.path === activePath ? ' is-active' : ''}${isMenuFor(target) ? ' is-menu' : ''}`}
                    onClick={() => setActivePath(b.path)}
                    onContextMenu={(e) => openMenu(e, target)}
                    title={`~/${b.path} (not saved yet) — right-click to rename or discard`}
                  >
                    <span className="k8s-explorer-glyph" aria-hidden>·</span>
                    <span className="k8s-explorer-name">{basename(b.path)}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {!canUseApi ? (
          <p className="k8s-explorer-note">Your files appear here once the cluster is ready.</p>
        ) : dirMissing ? (
          <div className="k8s-explorer-note">
            <span>{displayDir(dir)} doesn&apos;t exist yet.</span>
            <button type="button" className="k8s-files-btn" onClick={() => void createCurrentDir()}>
              Create folder
            </button>
          </div>
        ) : listing && listing.folders.length === 0 && listing.files.length === 0 && unsavedHere.length === 0 ? (
          <p className="k8s-explorer-note">Empty folder — use + File to start.</p>
        ) : null}
      </aside>

      <div className="k8s-files-main">
        <div className="k8s-files-bar">
          <button
            type="button"
            className={`k8s-files-explorer-toggle${explorerOpen ? ' is-open' : ''}`}
            onClick={() => setExplorerOpen((v) => !v)}
            title={explorerOpen ? 'Hide files' : 'Show files'}
            aria-label={explorerOpen ? 'Hide files' : 'Show files'}
            aria-pressed={explorerOpen}
          >
            ☰
          </button>
          <div className="k8s-files-tabs" role="tablist" aria-label="Open files">
            {bufs.map((b) => (
              <div
                key={b.path}
                role="tab"
                tabIndex={0}
                aria-selected={b.path === activePath}
                className={`k8s-files-tab${b.path === activePath ? ' active' : ''}`}
                title={`~/${b.path}${b.onDisk ? '' : ' (not saved yet)'}`}
                onClick={() => setActivePath(b.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setActivePath(b.path);
                }}
              >
                <span className={`k8s-files-tab-name${b.onDisk ? '' : ' is-new'}`}>{basename(b.path)}</span>
                {isDirty(b) ? <span className="k8s-files-dirty" aria-label="unsaved changes" /> : null}
                <button
                  type="button"
                  className="k8s-files-tab-x"
                  title={`Close ${basename(b.path)}`}
                  aria-label={`Close ${basename(b.path)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(b.path);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="k8s-files-actions">
            {notice ? (
              <span className={`k8s-files-notice is-${notice.kind}`} role="status">{notice.text}</span>
            ) : autosaveLabel ? (
              <span className={`k8s-files-autosave is-${autosaveTone}`} role="status" aria-live="polite">
                {autosaveLabel}
              </span>
            ) : null}
          </div>
        </div>
        <div className="k8s-lab-scratch-editor">
          {!current ? (
            <div className="k8s-files-empty k8s-files-welcome">
              <p className="k8s-files-welcome-title">
                Navigate to your Home directory and start working on the Lab.
              </p>
              <p className="k8s-files-welcome-sub">
                Files you create here are saved automatically and show up in the Terminal ({toggleHint}).
              </p>
              <button type="button" className="k8s-files-btn k8s-files-welcome-btn" onClick={openExplorerAtHome}>
                <IconFolderOpen /> Open explorer
              </button>
            </div>
          ) : current.content === null ? (
            <div className="k8s-files-empty">
              <span className="spinner" />
              <span>Opening ~/{current.path}…</span>
            </div>
          ) : (
            <LabYamlEditor
              key={current.path}
              value={current.content}
              onChange={(v) => updateContent(current.path, v)}
              active={active && renaming === null && !newFolderOpen}
              onSave={() => void saveBuffer(current.path)}
              placeholder="Start typing YAML…"
            />
          )}
        </div>
      </div>

      {menu && createPortal(
        <div
          className="k8s-explorer-menu"
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 170),
            top: Math.min(menu.y, window.innerHeight - 90),
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button type="button" role="menuitem" autoFocus onClick={() => startRename(menu)}>
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => void deleteEntry(menu)}
          >
            {menu.kind === 'unsaved' ? 'Discard' : 'Delete'}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
