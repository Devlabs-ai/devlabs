import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import MarkdownProse from '../components/MarkdownProse';
import SparkProjectEditor from '../components/SparkProjectEditor';
import { MAJORS_PATH, getProject, getProjectModule } from '../constants/projects';
import { MINORS_PATH, minorsFor } from '../constants/minors';
import { getModuleContent } from '../fixtures/projectModules';
import type { ProjectModuleContent } from '../fixtures/projectModules';

type BriefTab = 'theory' | 'tasks' | 'verify';

const BRIEF_MIN = 320;
const BRIEF_RATIO = 0.42;
const BRIEF_MAX_RATIO = 0.62;

function clampBriefWidth(width: number, shellWidth: number): number {
  const max = Math.max(BRIEF_MIN, Math.floor(shellWidth * BRIEF_MAX_RATIO));
  return Math.min(max, Math.max(BRIEF_MIN, Math.round(width)));
}

function storageKey(persistId: string): string {
  return `devlabs.workspace.${persistId}.files`;
}

/** Edits live in the browser until modules get a backend workspace. */
function loadSavedFiles(
  persistId: string,
  starter: Record<string, string>,
): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(storageKey(persistId));
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
}

/**
 * Theory reads as one article but is delivered a section at a time, so a long
 * brief never lands as a single wall of text. Sections break on `##`.
 */
function splitTheory(text: string): TheorySection[] {
  const sections: TheorySection[] = [];
  let title = '';
  let buffer: string[] = [];
  let inFence = false;

  const flush = (): void => {
    const body = buffer.join('\n').trim();
    if (body) sections.push({ title, body });
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
  minorIds?: string[];
  trail?: Array<{ to: string; label: string }>;
  title?: string;
}

export function ModuleWorkspace({
  persistId,
  content,
  minorIds,
  trail,
  title,
}: ModuleWorkspaceProps): JSX.Element {
  const relatedMinors = minorsFor(minorIds);
  const [files, setFiles] = useState<Record<string, string>>(() =>
    loadSavedFiles(persistId, content.files),
  );
  const [briefTab, setBriefTab] = useState<BriefTab>('theory');
  const [theoryPage, setTheoryPage] = useState(0);
  const [briefCollapsed, setBriefCollapsed] = useState(false);
  const [briefWidth, setBriefWidth] = useState(() =>
    typeof window !== 'undefined'
      ? clampBriefWidth(window.innerWidth * BRIEF_RATIO, window.innerWidth)
      : 520,
  );
  const [focusFile, setFocusFile] = useState(content.entryFile);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const briefBodyRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const theorySections = useMemo(() => splitTheory(content.theory), [content.theory]);
  const section = theorySections[Math.min(theoryPage, theorySections.length - 1)];

  // Fresh module: reset every piece of per-module state.
  useEffect(() => {
    setFiles(loadSavedFiles(persistId, content.files));
    setFocusFile(content.entryFile);
    setBriefTab('theory');
    setTheoryPage(0);
  }, [persistId, content]);

  // A new section starts at its own beginning, not where the last one ended.
  useEffect(() => {
    briefBodyRef.current?.scrollTo({ top: 0 });
  }, [theoryPage, briefTab]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey(persistId), JSON.stringify(files));
      } catch {
        // Quota or private mode — losing autosave is not worth breaking the page.
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [files, persistId]);

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
    window.localStorage.removeItem(storageKey(persistId));
    setFiles(content.files);
    setFocusFile(content.entryFile);
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
          briefCollapsed ? ' spark-brief-collapsed' : ''
        }`}
        style={
          briefCollapsed
            ? { gridTemplateColumns: 'minmax(0, 1fr)' }
            : { gridTemplateColumns: `${briefWidth}px 6px minmax(0, 1fr)` }
        }
      >
        {!briefCollapsed && (
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
                  {relatedMinors.map((minor) => (
                    <Link
                      key={minor.id}
                      to={`${MINORS_PATH}/${minor.id}`}
                      className="project-minor-chip"
                    >
                      {minor.name}
                    </Link>
                  ))}
                  <span className="project-module-progress" title="Blocks with the TODO marker removed">
                    {doneCount}/{content.tasks.length} blocks
                  </span>
                  <button type="button" className="topnav-pill topnav-action" onClick={resetModule}>
                    Reset
                  </button>
                </div>
                <button
                  type="button"
                  className="spark-brief-collapse-btn"
                  title="Collapse theory panel"
                  aria-label="Collapse theory panel"
                  onClick={() => setBriefCollapsed(true)}
                >
                  ⟨
                </button>
              </div>

              <div className="panel-body spark-brief-body" ref={briefBodyRef}>
                {briefTab === 'theory' && section && (
                  <div className="theory-reader">
                    {theorySections.length > 1 && (
                      <p className="theory-eyebrow">
                        Part {theoryPage + 1} of {theorySections.length}
                      </p>
                    )}

                    <MarkdownProse text={section.body} className="markdown-prose" />

                    {theorySections.length > 1 && (
                      <nav className="theory-pager" aria-label="Theory sections">
                        {theorySections.map((s, index) => (
                          <button
                            key={s.title || index}
                            type="button"
                            className={`theory-pager-dot${index === theoryPage ? ' active' : ''}`}
                            title={s.title}
                            aria-label={s.title}
                            aria-current={index === theoryPage}
                            onClick={() => setTheoryPage(index)}
                          />
                        ))}
                      </nav>
                    )}
                  </div>
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

        {!briefCollapsed && (
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

        {briefCollapsed && (
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
      minorIds={module.minors}
    />
  );
}
