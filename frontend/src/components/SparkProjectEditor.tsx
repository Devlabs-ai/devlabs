import React, { useEffect, useMemo, useRef, useState } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import type * as Monaco from 'monaco-editor';
import MarkdownProse from './MarkdownProse';
import type { SparkProjectFiles } from '../fixtures/dailyProductSalesL1';

loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' } });

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
    ],
    colors: {
      'editor.background': '#000000',
      'editor.foreground': '#eef0ff',
      'editor.lineHighlightBackground': '#0a0a0a',
      'editor.selectionBackground': '#222222',
      'editorCursor.foreground': '#34d399',
      'editorLineNumber.foreground': '#444444',
      'editorLineNumber.activeForeground': '#888888',
    },
  });
}

function detectLanguage(filePath: string): string {
  const base = filePath.split('/').pop() ?? '';
  const lower = base.toLowerCase();
  if (lower === 'makefile' || lower === 'dockerfile') return 'shell';
  if (lower === 'go.mod' || lower === 'go.sum') return 'plaintext';
  const ext = (base.split('.').pop() ?? '').toLowerCase();
  if (ext === 'py') return 'python';
  if (ext === 'md') return 'markdown';
  if (ext === 'json') return 'json';
  if (ext === 'yml' || ext === 'yaml') return 'yaml';
  if (ext === 'sh') return 'shell';
  if (ext === 'sql') return 'sql';
  if (ext === 'go') return 'go';
  if (ext === 'rs') return 'rust';
  if (ext === 'java') return 'java';
  if (ext === 'c' || ext === 'h') return 'c';
  if (ext === 'toml') return 'ini';
  return 'plaintext';
}

function normalizePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  type: 'file' | 'dir' | 'root';
}

function buildTree(files: SparkProjectFiles): TreeNode[] {
  type Mutable = { name: string; path: string; type: 'file' | 'dir'; children?: Mutable[] };
  const root: Mutable[] = [];

  const getOrCreateDir = (segments: string[]): Mutable[] => {
    let list = root;
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      let dir = list.find((n) => n.type === 'dir' && n.name === seg);
      if (!dir) {
        dir = { name: seg, path: acc, type: 'dir', children: [] };
        list.push(dir);
      }
      list = dir.children!;
    }
    return list;
  };

  for (const filePath of Object.keys(files).sort((a, b) => a.localeCompare(b))) {
    const parts = filePath.split('/');
    const fileName = parts.pop()!;
    const parent = parts.length ? getOrCreateDir(parts) : root;
    parent.push({ name: fileName, path: filePath, type: 'file' });
  }

  const sortNodes = (nodes: Mutable[]): TreeNode[] =>
    nodes
      .map((n) =>
        n.type === 'dir'
          ? { ...n, children: sortNodes(n.children || []) }
          : { name: n.name, path: n.path, type: 'file' as const },
      )
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

  return sortNodes(root);
}

function TreeView({
  nodes,
  activePath,
  depth,
  collapsed,
  onToggle,
  onOpen,
  onContextMenu,
}: {
  nodes: TreeNode[];
  activePath: string;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, type: 'file' | 'dir') => void;
}): JSX.Element {
  return (
    <>
      {nodes.map((node) => {
        if (node.type === 'dir') {
          const isCollapsed = collapsed.has(node.path);
          return (
            <div key={`d:${node.path}`}>
              <button
                type="button"
                className="spark-tree-item spark-tree-dir"
                style={{ paddingLeft: 8 + depth * 12 }}
                onClick={() => onToggle(node.path)}
                onContextMenu={(e) => onContextMenu(e, node.path, 'dir')}
              >
                <span className="spark-tree-chevron">{isCollapsed ? '▸' : '▾'}</span>
                <span className="spark-tree-icon">📁</span>
                <span>{node.name}</span>
              </button>
              {!isCollapsed && node.children && (
                <TreeView
                  nodes={node.children}
                  activePath={activePath}
                  depth={depth + 1}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  onContextMenu={onContextMenu}
                />
              )}
            </div>
          );
        }
        return (
          <button
            key={`f:${node.path}`}
            type="button"
            className={`spark-tree-item spark-tree-file ${activePath === node.path ? 'active' : ''}`}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => onOpen(node.path)}
            onDoubleClick={() => onOpen(node.path)}
            onContextMenu={(e) => onContextMenu(e, node.path, 'file')}
          >
            <span className="spark-tree-chevron-spacer" />
            <span className="spark-tree-icon">📄</span>
            <span>{node.name}</span>
          </button>
        );
      })}
    </>
  );
}

interface SparkProjectEditorProps {
  files: SparkProjectFiles;
  onChangeFiles: (files: SparkProjectFiles) => void;
  entryFile?: string;
  onContentChange?: (path: string, content: string) => void;
  onFileCreated?: (path: string, content: string) => void;
  onFileDeleted?: (path: string) => void;
  onFileRenamed?: (from: string, to: string) => void;
  /** Open a read-only tab (e.g. a previous submission snapshot). */
  previewOpenRequest?: { key: string; fileName: string; content: string } | null;
  onActivePathChange?: (path: string) => void;
  /** Restore published starter code (parent handles persist + confirm). */
  onResetToStarter?: () => void;
  resetting?: boolean;
}

export default function SparkProjectEditor({
  files,
  onChangeFiles,
  entryFile = 'src/main.py',
  onContentChange,
  onFileCreated,
  onFileDeleted,
  onFileRenamed,
  previewOpenRequest = null,
  onActivePathChange,
  onResetToStarter,
  resetting = false,
}: SparkProjectEditorProps): JSX.Element {
  const paths = Object.keys(files);
  const initialFile = paths.includes(entryFile) ? entryFile : paths[0] || '';

  const [openTabs, setOpenTabs] = useState<string[]>(() => (initialFile ? [initialFile] : []));
  const [activePath, setActivePath] = useState<string>(initialFile);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [ghostFiles, setGhostFiles] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [newPathOpen, setNewPathOpen] = useState(false);
  const [newPath, setNewPath] = useState('src/');
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const tree = useMemo(() => buildTree(files), [files]);
  const allFiles = useMemo(() => ({ ...files, ...ghostFiles }), [files, ghostFiles]);
  const viewingPath = previewPath || activePath;
  const language = detectLanguage(viewingPath);
  const content = allFiles[viewingPath] ?? '';
  const isPreview = Boolean(previewPath) || ghostFiles[viewingPath] != null;

  function isGhostPath(path: string): boolean {
    return ghostFiles[path] != null;
  }

  function ensureTab(path: string): void {
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }

  function openFile(path: string): void {
    if (isGhostPath(path)) {
      openPreview(path);
      return;
    }
    setPreviewPath(null);
    ensureTab(path);
    setActivePath(path);
  }

  function openPreview(path: string): void {
    ensureTab(path);
    setActivePath(path);
    setPreviewPath(path);
  }

  function closeTab(path: string, e?: React.MouseEvent): void {
    e?.stopPropagation();
    setGhostFiles((prev) => {
      if (prev[path] == null) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setOpenTabs((prev) => {
      const next = prev.filter((p) => p !== path);
      if (activePath === path) {
        const idx = prev.indexOf(path);
        const fallback = next[Math.max(0, idx - 1)] || next[0] || '';
        setActivePath(fallback);
        setPreviewPath(null);
      }
      return next;
    });
  }

  function fileLabel(path: string): string {
    return path.split('/').pop() || path;
  }

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e: MouseEvent): void => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!previewOpenRequest?.key || !previewOpenRequest.fileName) return;
    const path = `.submissions/${previewOpenRequest.fileName}`;
    setGhostFiles((prev) => ({ ...prev, [path]: previewOpenRequest.content }));
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActivePath(path);
    setPreviewPath(path);
  }, [previewOpenRequest]);

  useEffect(() => {
    if (activePath) onActivePathChange?.(activePath);
  }, [activePath, onActivePathChange]);

  function handleMount(editor: MonacoEditorNS.IStandaloneCodeEditor, monaco: typeof Monaco): void {
    editorRef.current = editor;
    defineTheme(monaco);
    monaco.editor.setTheme(THEME_NAME);
  }

  function updateActiveContent(value: string): void {
    if (!activePath || isPreview) return;
    onChangeFiles({ ...files, [activePath]: value });
    onContentChange?.(activePath, value);
  }

  function toggleDir(path: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function showContextMenu(e: React.MouseEvent, path: string, type: 'file' | 'dir' | 'root'): void {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, path, type });
  }

  function createFile(suggested?: string): void {
    const path = normalizePath(suggested ?? newPath);
    if (!path || path.endsWith('/')) return;
    if (files[path] != null) {
      openFile(path);
      setNewPathOpen(false);
      setMenu(null);
      return;
    }
    onChangeFiles({ ...files, [path]: '' });
    onFileCreated?.(path, '');
    openFile(path);
    setNewPathOpen(false);
    setNewPath('src/');
    setMenu(null);
  }

  function deletePath(path: string): void {
    if (isGhostPath(path)) {
      closeTab(path);
      setMenu(null);
      return;
    }
    const next = { ...files };
    if (files[path] != null) {
      delete next[path];
    } else {
      // directory: delete all children
      for (const key of Object.keys(next)) {
        if (key === path || key.startsWith(`${path}/`)) delete next[key];
      }
    }
    const removed = Object.keys(files).filter((key) => !(key in next));
    onChangeFiles(next);
    for (const key of removed) onFileDeleted?.(key);
    setOpenTabs((prev) => {
      const filtered = prev.filter(
        (p) => p !== path && !p.startsWith(`${path}/`) && next[p] != null,
      );
      if (activePath === path || activePath.startsWith(`${path}/`)) {
        const fallback =
          filtered.find((p) => p === entryFile) ||
          filtered[0] ||
          Object.keys(next).find((p) => p === entryFile) ||
          Object.keys(next)[0] ||
          '';
        setActivePath(fallback);
        if (fallback && !filtered.includes(fallback)) {
          return [...filtered, fallback];
        }
      }
      return filtered;
    });
    if (previewPath === path || previewPath?.startsWith(`${path}/`)) setPreviewPath(null);
    setMenu(null);
  }

  function startRename(path: string): void {
    if (isGhostPath(path)) {
      setMenu(null);
      return;
    }
    setRenamePath(path);
    setRenameValue(path);
    setMenu(null);
  }

  function commitRename(): void {
    if (!renamePath) return;
    const dest = normalizePath(renameValue);
    if (!dest || dest.endsWith('/') || dest === renamePath) {
      setRenamePath(null);
      return;
    }
    if (files[dest] != null) {
      setToast('A file already exists at that path');
      return;
    }
    const next = { ...files };
    const renames: Array<{ from: string; to: string }> = [];
    if (files[renamePath] != null) {
      next[dest] = next[renamePath];
      delete next[renamePath];
      renames.push({ from: renamePath, to: dest });
    } else {
      for (const key of Object.keys(files)) {
        if (key === renamePath || key.startsWith(`${renamePath}/`)) {
          const suffix = key.slice(renamePath.length);
          const to = `${dest}${suffix}`;
          next[to] = next[key];
          delete next[key];
          renames.push({ from: key, to });
        }
      }
    }
    onChangeFiles(next);
    for (const r of renames) onFileRenamed?.(r.from, r.to);
    setOpenTabs((prev) =>
      prev.map((p) => {
        if (p === renamePath) return dest;
        if (p.startsWith(`${renamePath}/`)) return `${dest}${p.slice(renamePath.length)}`;
        return p;
      }),
    );
    if (activePath === renamePath || activePath.startsWith(`${renamePath}/`)) {
      setActivePath(
        activePath === renamePath
          ? dest
          : `${dest}${activePath.slice(renamePath.length)}`,
      );
    }
    if (previewPath === renamePath || previewPath?.startsWith(`${renamePath}/`)) {
      setPreviewPath(
        previewPath === renamePath
          ? dest
          : `${dest}${previewPath!.slice(renamePath.length)}`,
      );
    }
    setRenamePath(null);
  }

  async function runMenuAction(action: string): Promise<void> {
    if (!menu) return;
    const { path, type } = menu;

    switch (action) {
      case 'open':
        if (type === 'file') openFile(path);
        break;
      case 'preview':
        if (type === 'file') openPreview(path);
        break;
      case 'copy-path':
        await copyText(path);
        setToast('Path copied');
        break;
      case 'copy-relative':
        await copyText(path);
        setToast('Relative path copied');
        break;
      case 'copy-contents':
        if (type === 'file' && files[path] != null) {
          await copyText(files[path]);
          setToast('Contents copied');
        }
        break;
      case 'rename':
        if (type === 'file' || type === 'dir') startRename(path);
        return;
      case 'delete':
        if (type === 'file' || type === 'dir') deletePath(path);
        return;
      case 'new-file': {
        const base = type === 'dir' ? `${path}/` : type === 'root' ? 'src/' : `${parentDir(path)}/`;
        setNewPath(`${base}untitled.py`);
        setNewPathOpen(true);
        break;
      }
      default:
        break;
    }
    setMenu(null);
  }

  const showMarkdownPreview = isPreview && viewingPath.endsWith('.md');

  return (
    <div
      className={`spark-project-editor spark-project-editor--overlay-explorer${explorerOpen ? ' spark-explorer-open' : ' spark-explorer-collapsed'}`}
    >
      <div className="spark-project-main">
        <div className="spark-editor-tabs-bar">
          <div className="spark-editor-tabs" role="tablist" aria-label="Open files">
            {openTabs.map((path) => {
              const active = path === activePath;
              return (
                <button
                  key={path}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`spark-editor-tab${active ? ' active' : ''}${previewPath === path ? ' preview' : ''}`}
                  title={path}
                  onClick={() => {
                    if (ghostFiles[path] != null) openPreview(path);
                    else openFile(path);
                  }}
                  onContextMenu={(e) => showContextMenu(e, path, 'file')}
                  onAuxClick={(e) => {
                    if (e.button === 1) closeTab(path, e);
                  }}
                >
                  <span className="spark-editor-tab-label">{fileLabel(path)}</span>
                  {previewPath === path && (
                    <span className="spark-editor-tab-preview">
                      {ghostFiles[path] != null ? 'Submission' : 'Preview'}
                    </span>
                  )}
                  <span
                    className="spark-editor-tab-close"
                    role="presentation"
                    onClick={(e) => closeTab(path, e)}
                    title="Close"
                  >
                    ×
                  </span>
                </button>
              );
            })}
          </div>
          <div className="spark-editor-tabs-actions">
            {onResetToStarter && (
              <button
                type="button"
                className="spark-editor-reset"
                title="Reset to starter code"
                aria-label="Reset to starter code"
                disabled={resetting}
                onClick={onResetToStarter}
              >
                {resetting ? 'Resetting…' : 'Reset'}
              </button>
            )}
            <button
              type="button"
              className={`spark-explorer-arrow${explorerOpen ? ' active' : ''}`}
              title={explorerOpen ? 'Hide file tree' : 'Show file tree'}
              aria-label={explorerOpen ? 'Hide file tree' : 'Show file tree'}
              aria-expanded={explorerOpen}
              onClick={() => setExplorerOpen((v) => !v)}
            >
              <span aria-hidden>{explorerOpen ? '←' : '→'}</span>
            </button>
          </div>
        </div>
        <div className="code-editor-body">
          {!viewingPath ? (
            <p className="dim" style={{ padding: 16 }}>Create a file to start coding.</p>
          ) : showMarkdownPreview ? (
            <div className="spark-md-preview">
              <MarkdownProse text={content} className="markdown-prose" />
            </div>
          ) : (
            <MonacoEditor
              path={viewingPath}
              language={language}
              value={content}
              theme={THEME_NAME}
              onMount={handleMount}
              onChange={(val) => updateActiveContent(val ?? '')}
              options={{
                fontSize: 13,
                fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
                fontLigatures: true,
                lineHeight: 20,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 10, bottom: 10 },
                renderLineHighlight: 'line',
                tabSize: language === 'python' ? 4 : 2,
                wordWrap: language === 'markdown' ? 'on' : 'off',
                folding: true,
                lineNumbers: 'on',
                glyphMargin: false,
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                overviewRulerBorder: false,
                readOnly: isPreview,
                scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
              }}
            />
          )}
        </div>
      </div>

      {explorerOpen && (
      <aside className="spark-project-sidebar spark-project-sidebar--overlay">
        <div className="spark-project-sidebar-header">
          <span>FILES</span>
          <div className="spark-project-sidebar-actions">
            <button
              type="button"
              className="ghost sm"
              title="New file"
              onClick={() => {
                setNewPath('src/untitled.py');
                setNewPathOpen((v) => !v);
              }}
            >
              +
            </button>
            <button
              type="button"
              className="ghost sm"
              title="Close files"
              onClick={() => setExplorerOpen(false)}
            >
              ×
            </button>
          </div>
        </div>
        {newPathOpen && (
          <div className="spark-project-newfile">
            <input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFile();
                if (e.key === 'Escape') setNewPathOpen(false);
              }}
              placeholder="src/helpers.py"
              aria-label="New file path"
              autoFocus
            />
            <button type="button" className="ghost sm" onClick={() => createFile()}>
              Add
            </button>
          </div>
        )}
        {renamePath && (
          <div className="spark-project-newfile">
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenamePath(null);
              }}
              aria-label="Rename path"
              autoFocus
            />
            <button type="button" className="ghost sm" onClick={commitRename}>
              Rename
            </button>
          </div>
        )}
        <div
          className="spark-project-tree"
          onContextMenu={(e) => showContextMenu(e, '', 'root')}
        >
          <div className="spark-tree-root-label">project</div>
          <TreeView
            nodes={tree}
            activePath={activePath}
            depth={0}
            collapsed={collapsed}
            onToggle={toggleDir}
            onOpen={openFile}
            onContextMenu={(e, path, type) => showContextMenu(e, path, type)}
          />
        </div>
      </aside>
      )}

      {menu && (
        <div
          ref={menuRef}
          className="spark-context-menu"
          style={{ top: menu.y, left: menu.x }}
          role="menu"
        >
          {menu.type === 'file' && (
            <>
              <button type="button" role="menuitem" onClick={() => runMenuAction('open')}>Open</button>
              <button type="button" role="menuitem" onClick={() => runMenuAction('preview')}>
                Open Preview
              </button>
              <div className="spark-context-sep" />
              <button type="button" role="menuitem" onClick={() => runMenuAction('copy-path')}>
                Copy Path
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction('copy-relative')}>
                Copy Relative Path
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction('copy-contents')}>
                Copy Contents
              </button>
              <div className="spark-context-sep" />
              <button type="button" role="menuitem" onClick={() => runMenuAction('rename')}>
                Rename…
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction('new-file')}>
                New File…
              </button>
              <div className="spark-context-sep" />
              <button
                type="button"
                role="menuitem"
                className="spark-context-danger"
                onClick={() => runMenuAction('delete')}
              >
                Delete
              </button>
            </>
          )}
          {menu.type === 'dir' && (
            <>
              <button type="button" role="menuitem" onClick={() => runMenuAction('new-file')}>
                New File…
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction('copy-path')}>
                Copy Path
              </button>
              <div className="spark-context-sep" />
              <button type="button" role="menuitem" onClick={() => runMenuAction('rename')}>
                Rename…
              </button>
              <button
                type="button"
                role="menuitem"
                className="spark-context-danger"
                onClick={() => runMenuAction('delete')}
              >
                Delete
              </button>
            </>
          )}
          {menu.type === 'root' && (
            <button type="button" role="menuitem" onClick={() => runMenuAction('new-file')}>
              New File…
            </button>
          )}
        </div>
      )}

      {toast && <div className="spark-toast">{toast}</div>}
    </div>
  );
}

/** Concatenate Python sources for mock submit heuristics. */
export function collectPythonSources(files: SparkProjectFiles): string {
  return Object.entries(files)
    .filter(([path]) => path.endsWith('.py'))
    .map(([, content]) => content)
    .join('\n\n');
}
