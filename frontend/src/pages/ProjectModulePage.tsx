import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import MarkdownProse from '../components/MarkdownProse';
import SparkProjectEditor from '../components/SparkProjectEditor';
import WorkspaceMobileSwitcher, {
  type WorkspaceMobilePane,
} from '../components/WorkspaceMobileSwitcher';
import DesktopOnlyNotice from '../components/DesktopOnlyNotice';
import { MAJORS_PATH, getProject, getProjectModule } from '../constants/projects';
import { MINORS_PATH } from '../constants/minors';
import { getModuleContent } from '../fixtures/projectModules';
import type { ProjectModuleContent } from '../fixtures/projectModules';
import { useIsNarrowUi } from '../hooks/useMediaQuery';
import { readMigrating, removeMigrating, writeMigrating } from '../utils/storageMigrate';

type BriefTab = 'theory' | 'tasks' | 'verify';

const BRIEF_MIN = 320;
const BRIEF_RATIO = 0.42;
const BRIEF_MAX_RATIO = 0.62;

function clampBriefWidth(width: number, shellWidth: number): number {
  const max = Math.max(BRIEF_MIN, Math.floor(shellWidth * BRIEF_MAX_RATIO));
  return Math.min(max, Math.max(BRIEF_MIN, Math.round(width)));
}

function storageKeys(persistId: string): { next: string; legacy: string } {
  return {
    next: `devsetu.workspace.${persistId}.files`,
    legacy: `devlabs.workspace.${persistId}.files`,
  };
}

function theoryStorageKeys(persistId: string): { next: string; legacy: string } {
  return {
    next: `devsetu.workspace.${persistId}.theory`,
    legacy: `devlabs.workspace.${persistId}.theory`,
  };
}

function loadSavedTheory(persistId: string, fallback: string): string {
  try {
    const { next, legacy } = theoryStorageKeys(persistId);
    const raw = readMigrating(window.localStorage, next, legacy);
    if (typeof raw === 'string' && raw.trim()) return raw;
  } catch {
    // ignore
  }
  return fallback;
}

/** Edits live in the browser until modules get a backend workspace. */
function loadSavedFiles(
  persistId: string,
  starter: Record<string, string>,
): Record<string, string> {
  try {
    const { next, legacy } = storageKeys(persistId);
    const raw = readMigrating(window.localStorage, next, legacy);
    if (!raw) return starter;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const restored: Record<string, string> = {};
    for (const path of Object.keys(starter)) {
      const saved = parsed[path];
      restored[path] = typeof saved === 'string' ? saved : starter[path];
    }
    return restored;
  } catch {
    return starter;
  }
}

interface TheorySection {
  title: string;
  body: string;
  mode: 'read-only' | 'read-and-implement';
  taskIds: string[];
}

const MODE_META =
  /^<!--\s*mode:\s*(read-only|read-and-implement)(?:\s+tasks:([\d.,\s]+))?\s*-->\s*$/m;

function parseTheoryMode(body: string): {
  body: string;
  mode: TheorySection['mode'];
  taskIds: string[];
} {
  const match = body.match(MODE_META);
  if (!match) {
    return { body: body.trim(), mode: 'read-only', taskIds: [] };
  }
  const mode = match[1] as TheorySection['mode'];
  const taskIds = (match[2] || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const cleaned = body.replace(MODE_META, '').trim();
  return { body: cleaned, mode, taskIds };
}

/**
 * Theory reads as one article but is delivered a section at a time, so a long
 * brief never lands as a single wall of text. Sections break on `##`.
 * Optional HTML comment under the heading: `<!-- mode: read-only -->` or
 * `<!-- mode: read-and-implement tasks:1.1,1.2 -->`.
 */
function splitTheory(text: string): TheorySection[] {
  const sections: TheorySection[] = [];
  let title = '';
  let buffer: string[] = [];
  let inFence = false;

  const flush = (): void => {
    const raw = buffer.join('\n').trim();
    if (!raw) return;
    const parsed = parseTheoryMode(raw);
    const withoutHeading = parsed.body.replace(/^##\s+.+\n?/, '').trim();
    if (!withoutHeading) return;
    sections.push({
      title: title || 'Theory',
      body: withoutHeading,
      mode: parsed.mode,
      taskIds: parsed.taskIds,
    });
  };

  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;

    if (!inFence) {
      const section = line.match(/^##\s+(.+)$/);
      if (section) {
        flush();
        title = section[1].trim();
        buffer = [line];
        continue;
      }
      const heading = line.match(/^#\s+(.+)$/);
      if (heading && !title) title = heading[1].trim();
    }

    buffer.push(line);
  }
  flush();

  return sections;
}

/** A task is done once its TODO marker is gone from the file. */
function taskDone(files: Record<string, string>, file: string, id: string): boolean {
  const source = files[file];
  if (typeof source !== 'string') return false;
  return !source.includes(`TODO(${id})`);
}

interface ModuleWorkspaceProps {
  persistId: string;
  content: ProjectModuleContent;
  trail?: Array<{ to: string; label: string }>;
  title?: string;
}

export function ModuleWorkspace({
  persistId,
  content,
  trail,
  title,
}: ModuleWorkspaceProps): JSX.Element {
  const [files, setFiles] = useState<Record<string, string>>(() =>
    loadSavedFiles(persistId, content.files),
  );
  const [briefTab, setBriefTab] = useState<BriefTab>('theory');
  const [theoryPage, setTheoryPage] = useState(0);
  const isNarrow = useIsNarrowUi();
  const [mobilePane, setMobilePane] = useState<WorkspaceMobilePane>('brief');
  const [briefCollapsed, setBriefCollapsed] = useState(false);
  const [briefWidth, setBriefWidth] = useState(() =>
    typeof window !== 'undefined'
      ? clampBriefWidth(window.innerWidth * BRIEF_RATIO, window.innerWidth)
      : 520,
  );
  const [focusFile, setFocusFile] = useState(content.entryFile);
  const [theoryMarkdown, setTheoryMarkdown] = useState(() =>
    loadSavedTheory(persistId, content.theory),
  );
  const [theoryEditing, setTheoryEditing] = useState(false);
  const [theoryDraft, setTheoryDraft] = useState(() =>
    loadSavedTheory(persistId, content.theory),
  );
  const [theoryCopyStatus, setTheoryCopyStatus] = useState<string | null>(null);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const briefBodyRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const showBrief = isNarrow ? mobilePane === 'brief' : !briefCollapsed;
  const showWorkspace = isNarrow ? mobilePane === 'workspace' : true;
  const showResize = !isNarrow && !briefCollapsed;

  const theorySections = useMemo(() => splitTheory(theoryMarkdown), [theoryMarkdown]);
  const section = theorySections[Math.min(theoryPage, theorySections.length - 1)];
  const theoryDirty = theoryMarkdown !== content.theory;

  // Fresh module: reset every piece of per-module state.
  useEffect(() => {
    const nextTheory = loadSavedTheory(persistId, content.theory);
    setFiles(loadSavedFiles(persistId, content.files));
    setFocusFile(content.entryFile);
    setBriefTab('theory');
    setTheoryPage(0);
    setTheoryMarkdown(nextTheory);
    setTheoryDraft(nextTheory);
    setTheoryEditing(false);
    setTheoryCopyStatus(null);
  }, [persistId, content]);

  // Keep page in range when theory sections change after an edit.
  useEffect(() => {
    if (theoryPage > 0 && theoryPage >= theorySections.length) {
      setTheoryPage(Math.max(0, theorySections.length - 1));
    }
  }, [theorySections.length, theoryPage]);

  // A new section starts at its own beginning, not where the last one ended.
  useEffect(() => {
    briefBodyRef.current?.scrollTo({ top: 0 });
  }, [theoryPage, briefTab, theoryEditing]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const { next, legacy } = storageKeys(persistId);
        writeMigrating(window.localStorage, next, legacy, JSON.stringify(files));
      } catch {
        // Quota or private mode — losing autosave is not worth breaking the page.
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [files, persistId]);

  const applyTheoryDraft = useCallback((): void => {
    setTheoryMarkdown(theoryDraft);
    setTheoryPage(0);
    setTheoryEditing(false);
    setTheoryCopyStatus(null);
    try {
      const { next, legacy } = theoryStorageKeys(persistId);
      if (theoryDraft === content.theory) {
        removeMigrating(window.localStorage, next, legacy);
      } else {
        writeMigrating(window.localStorage, next, legacy, theoryDraft);
      }
    } catch {
      // ignore quota
    }
  }, [theoryDraft, content.theory, persistId]);

  const cancelTheoryEdit = useCallback((): void => {
    setTheoryDraft(theoryMarkdown);
    setTheoryEditing(false);
    setTheoryCopyStatus(null);
  }, [theoryMarkdown]);

  const resetTheoryToAuthored = useCallback((): void => {
    if (!window.confirm('Reset theory to the authored fixture? Your local rewrite will be discarded.')) {
      return;
    }
    setTheoryMarkdown(content.theory);
    setTheoryDraft(content.theory);
    setTheoryPage(0);
    setTheoryEditing(false);
    setTheoryCopyStatus(null);
    try {
      const { next, legacy } = theoryStorageKeys(persistId);
      removeMigrating(window.localStorage, next, legacy);
    } catch {
      // ignore
    }
  }, [content.theory, persistId]);

  const copyTheoryMarkdown = useCallback(async (): Promise<void> => {
    const text = theoryEditing ? theoryDraft : theoryMarkdown;
    try {
      await navigator.clipboard.writeText(text);
      setTheoryCopyStatus('Copied');
      window.setTimeout(() => setTheoryCopyStatus(null), 1600);
    } catch {
      setTheoryCopyStatus('Copy failed');
      window.setTimeout(() => setTheoryCopyStatus(null), 2000);
    }
  }, [theoryEditing, theoryDraft, theoryMarkdown]);

  const onResizeMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !shellRef.current) return;
    const rect = shellRef.current.getBoundingClientRect();
    setBriefWidth(clampBriefWidth(e.clientX - rect.left, rect.width));
  }, []);

  const onResizeEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent): void => onResizeMove(e);
    const up = (): void => onResizeEnd();
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [onResizeMove, onResizeEnd]);

  const doneCount = content.tasks.filter((t) => taskDone(files, t.file, t.id)).length;

  function resetModule(): void {
    if (!window.confirm('Reset this module? Your edits will be discarded.')) return;
    const filesKeys = storageKeys(persistId);
    const theoryKeys = theoryStorageKeys(persistId);
    removeMigrating(window.localStorage, filesKeys.next, filesKeys.legacy);
    try {
      removeMigrating(window.localStorage, theoryKeys.next, theoryKeys.legacy);
    } catch {
      // ignore
    }
    setFiles(content.files);
    setFocusFile(content.entryFile);
    setTheoryMarkdown(content.theory);
    setTheoryDraft(content.theory);
    setTheoryPage(0);
    setTheoryEditing(false);
    setTheoryCopyStatus(null);
  }

  return (
    <div className="app-page project-module-page">
      {trail && trail.length > 0 && (
        <p className="play-papers-crumb project-module-crumb">
          {trail.map((step, index) => (
            <span key={step.to}>
              {index > 0 && <span aria-hidden> / </span>}
              <Link to={step.to}>{step.label}</Link>
            </span>
          ))}
          {title && (
            <>
              <span aria-hidden> / </span>
              <span>{title}</span>
            </>
          )}
        </p>
      )}
      <div
        ref={shellRef}
        className={`workspace sandbox-workspace spark-platform-workspace project-module-shell${
          !isNarrow && briefCollapsed ? ' spark-brief-collapsed' : ''
        }${isNarrow ? ` workspace--mobile workspace--mobile-pane-${mobilePane}` : ''}`}
        style={
          isNarrow || briefCollapsed
            ? { gridTemplateColumns: 'minmax(0, 1fr)' }
            : { gridTemplateColumns: `${briefWidth}px 6px minmax(0, 1fr)` }
        }
      >
        {isNarrow && (
          <WorkspaceMobileSwitcher
            pane={mobilePane}
            onChange={setMobilePane}
            briefLabel="Theory"
            workspaceLabel="Editor"
          />
        )}
        {showBrief && (
          <div className="col spark-brief-col">
            <div
              className="panel sandbox-brief-panel--solo spark-brief-panel--bare"
              style={{ flex: 1 }}
            >
              <div className="spark-brief-tabs" role="tablist" aria-label="Module sections">
                {(
                  [
                    ['theory', 'Theory'],
                    ['tasks', 'Tasks'],
                    ['verify', 'Verify'],
                  ] as Array<[BriefTab, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={briefTab === id}
                    className={`spark-brief-tab${briefTab === id ? ' active' : ''}`}
                    onClick={() => setBriefTab(id)}
                  >
                    {label}
                    {id === 'tasks' && (
                      <span className="spark-brief-tab-count">{content.tasks.length}</span>
                    )}
                  </button>
                ))}
                <div className="project-module-tab-actions">
                  <span className="project-module-progress" title="Blocks with the TODO marker removed">
                    {doneCount}/{content.tasks.length} blocks
                  </span>
                  {briefTab === 'theory' && !theoryEditing && (
                    <button
                      type="button"
                      className="topnav-pill topnav-action"
                      title="Edit theory markdown"
                      onClick={() => {
                        setTheoryDraft(theoryMarkdown);
                        setTheoryEditing(true);
                        setTheoryCopyStatus(null);
                      }}
                    >
                      Edit
                      {theoryDirty ? ' •' : ''}
                    </button>
                  )}
                  <button type="button" className="topnav-pill topnav-action" onClick={resetModule}>
                    Reset
                  </button>
                </div>
                {!isNarrow && (
                  <button
                    type="button"
                    className="spark-brief-collapse-btn"
                    title="Collapse theory panel"
                    aria-label="Collapse theory panel"
                    onClick={() => setBriefCollapsed(true)}
                  >
                    ⟨
                  </button>
                )}
              </div>

              <div
                className={`panel-body spark-brief-body${theoryEditing && briefTab === 'theory' ? ' spark-brief-body--theory-edit' : ''}`}
                ref={briefBodyRef}
              >
                {briefTab === 'theory' && theoryEditing && (
                  <div className="spark-brief-admin spark-brief-admin--open project-theory-editor">
                    <div className="spark-brief-admin-bar">
                      <span className="spark-brief-admin-format">Theory markdown</span>
                      <button
                        type="button"
                        className="spark-ide-btn spark-ide-btn--run"
                        disabled={theoryDraft === theoryMarkdown}
                        onClick={applyTheoryDraft}
                      >
                        Apply
                      </button>
                      <button type="button" className="ghost sm" onClick={cancelTheoryEdit}>
                        Cancel
                      </button>
                      <button type="button" className="ghost sm" onClick={() => void copyTheoryMarkdown()}>
                        {theoryCopyStatus || 'Copy'}
                      </button>
                      {theoryDirty && (
                        <button type="button" className="ghost sm" onClick={resetTheoryToAuthored}>
                          Reset authored
                        </button>
                      )}
                    </div>
                    <p className="project-theory-editor-hint">
                      Edits apply in this browser. Copy the markdown into{' '}
                      <code>theory.md</code> when you want it in the repo.
                    </p>
                    <textarea
                      className="spark-brief-admin-editor"
                      spellCheck={false}
                      value={theoryDraft}
                      onChange={(e) => setTheoryDraft(e.target.value)}
                      aria-label="Theory markdown editor"
                    />
                  </div>
                )}

                {briefTab === 'theory' && !theoryEditing && section && (
                  <div className="theory-reader">
                    <div className="theory-section-head">
                      {theorySections.length > 1 && (
                        <p className="theory-eyebrow">
                          Part {theoryPage + 1} of {theorySections.length}
                        </p>
                      )}
                      <span
                        className={`theory-mode-badge theory-mode-badge--${
                          section.mode === 'read-and-implement' ? 'implement' : 'read'
                        }`}
                      >
                        {section.mode === 'read-and-implement'
                          ? 'Read and Implement'
                          : 'Read only'}
                      </span>
                    </div>

                    <h2 className="theory-section-title">{section.title}</h2>

                    <MarkdownProse text={section.body} className="markdown-prose" />

                    {section.mode === 'read-and-implement' && section.taskIds.length > 0 && (
                      <div className="theory-implement-callout">
                        <p className="theory-implement-lead">
                          Complete these tasks in the repo, then continue.
                        </p>
                        <ul className="theory-implement-tasks">
                          {section.taskIds.map((id) => {
                            const task = content.tasks.find((t) => t.id === id);
                            if (!task) return null;
                            const done = taskDone(files, task.file, task.id);
                            return (
                              <li key={id}>
                                <button
                                  type="button"
                                  className={`theory-implement-task${done ? ' is-done' : ''}`}
                                  onClick={() => {
                                    setBriefTab('tasks');
                                    setFocusFile(task.file);
                                  }}
                                >
                                  <span>TODO({task.id})</span>
                                  <strong>{task.label}</strong>
                                  <span>{done ? 'done' : 'open'}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {theorySections.length > 1 && (
                      <nav className="theory-pager" aria-label="Theory sections">
                        <button
                          type="button"
                          className="theory-pager-arrow"
                          disabled={theoryPage <= 0}
                          aria-label="Previous section"
                          title={
                            theoryPage > 0
                              ? theorySections[theoryPage - 1]?.title
                              : undefined
                          }
                          onClick={() => setTheoryPage((page) => Math.max(0, page - 1))}
                        >
                          <span aria-hidden>‹</span>
                        </button>
                        <span className="theory-pager-status">
                          {theoryPage + 1} / {theorySections.length}
                        </span>
                        <button
                          type="button"
                          className="theory-pager-arrow"
                          disabled={theoryPage >= theorySections.length - 1}
                          aria-label="Next section"
                          title={
                            theoryPage < theorySections.length - 1
                              ? theorySections[theoryPage + 1]?.title
                              : undefined
                          }
                          onClick={() =>
                            setTheoryPage((page) =>
                              Math.min(theorySections.length - 1, page + 1),
                            )
                          }
                        >
                          <span aria-hidden>›</span>
                        </button>
                      </nav>
                    )}
                  </div>
                )}

                {briefTab === 'theory' && !theoryEditing && !section && (
                  <p className="project-task-lead">No theory sections yet. Click Edit to add markdown.</p>
                )}

                {briefTab === 'tasks' && (
                  <div className="project-task-list">
                    <p className="project-task-lead">
                      Everything else in the repo is written for you. Open a task to jump to its
                      file — the marker disappears when you replace the block.
                    </p>
                    {content.tasks.map((task) => {
                      const done = taskDone(files, task.file, task.id);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          className={`project-task${done ? ' project-task--done' : ''}`}
                          onClick={() => setFocusFile(task.file)}
                        >
                          <span className="project-task-id">TODO({task.id})</span>
                          <span className="project-task-body">
                            <strong className="project-task-label">{task.label}</strong>
                            <span className="project-task-summary">{task.summary}</span>
                            <code className="project-task-file">{task.file}</code>
                          </span>
                          <span className="project-task-state">{done ? 'done' : 'open'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {briefTab === 'verify' && (
                  <div className="project-verify">
                    <p className="project-task-lead">
                      Run these from the project root. The tests talk to your server over a real
                      socket, so passing them means the thing actually works.
                    </p>
                    <ul className="project-verify-list">
                      {content.verify.map((cmd) => (
                        <li key={cmd}>
                          <code>{cmd}</code>
                        </li>
                      ))}
                    </ul>
                    <p className="project-verify-note">
                      There is no runner attached to project modules yet, so run them in your own
                      terminal. Your edits here are saved in this browser.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showResize && (
          <div
            className="spark-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize theory panel"
            onMouseDown={() => {
              dragging.current = true;
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
            onDoubleClick={() => {
              const width = shellRef.current?.getBoundingClientRect().width || window.innerWidth;
              setBriefWidth(clampBriefWidth(width * BRIEF_RATIO, width));
            }}
          />
        )}

        {!isNarrow && briefCollapsed && (
          <button
            type="button"
            className="spark-brief-reopen-float"
            title="Show theory panel"
            aria-label="Show theory panel"
            onClick={() => setBriefCollapsed(false)}
          >
            ⟩
          </button>
        )}

        {showWorkspace && isNarrow && (
          <DesktopOnlyNotice
              tools="code editor and scratch pad"
              briefLabel="Read the theory"
              onShowBrief={() => setMobilePane('brief')}
            />
        )}
        {showWorkspace && !isNarrow && (
          <div className="col col-main">
            <div className="panel spark-ide-panel" style={{ flex: 1 }}>
              <SparkProjectEditor
                key={`${persistId}:${focusFile}`}
                files={files}
                onChangeFiles={setFiles}
                entryFile={focusFile}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProjectModulePage(): JSX.Element {
  const { projectId, moduleId } = useParams<{ projectId: string; moduleId: string }>();

  if (projectId === 'cinder' && moduleId === 'tcp-server') {
    return <Navigate to={`${MINORS_PATH}/tcp-server`} replace />;
  }

  const project = getProject(projectId);
  if (!project || project.status !== 'ready') return <Navigate to={MAJORS_PATH} replace />;

  const module = getProjectModule(project, moduleId);
  if (!module) return <Navigate to={`${MAJORS_PATH}/${project.id}`} replace />;

  const content = getModuleContent(project.id, module.id);
  if (!content) return <Navigate to={`${MAJORS_PATH}/${project.id}`} replace />;

  return (
    <ModuleWorkspace
      persistId={`${project.id}.${module.id}`}
      content={content}
    />
  );
}
