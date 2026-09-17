import React, { useEffect, useMemo, useRef, useState } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import ProblemStatement from './ProblemStatement';
import BriefAdminEditor, { isEditableBriefTab } from './BriefAdminEditor';
import TerminalPanel from './TerminalPanel';
import WorkspaceMobileSwitcher, { type WorkspaceMobilePane } from './WorkspaceMobileSwitcher';
import { IconPen, IconSubmit } from './ChromeIcons';
import { useIsNarrowUi } from '../hooks/useMediaQuery';
import { fetchChallenge, fetchChallengeSolution } from '../services/challengeApi';
import { isAdminUser, getCurrentUser } from '../services/authApi';
import {
  fetchK8sSubmissions,
  gradeK8sSession,
  resetK8sSession,
  type K8sSubmissionRecord,
} from '../services/workspaceApi';
import type { ActiveSession, ChallengeFull, ChallengePublic } from '../types/domain';
import type { ProblemStatementTab } from './ProblemStatement';
import { useAppState } from '../context/AppStateContext';

loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' } });

interface K8sLabWorkspaceProps {
  challenge: ChallengePublic | ChallengeFull | null;
  session: ActiveSession;
  onClose: () => void;
}

const BRIEF_PCT_KEY = 'devlabs.k8sLab.briefPct.v1';
const SCRATCH_KEY_PREFIX = 'devlabs.k8sLab.scratch.v2.';
/** Description share of the workspace shell (terminal gets the rest). */
const DEFAULT_BRIEF_PCT = 45;
const MIN_BRIEF_PCT = 22;
const MAX_BRIEF_PCT = 70;

/** Scratch pad starts empty — candidates draft their own YAML. */
function defaultScratchFor(_challengeId: string): string {
  return '';
}

function clampBriefPct(pct: number): number {
  return Math.min(MAX_BRIEF_PCT, Math.max(MIN_BRIEF_PCT, Math.round(pct)));
}

function k8sTerminalWsUrl(sessionId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws/k8s-terminal?sessionId=${sessionId}`;
}

function scratchStorageKey(sessionId: string, challengeId: string): string {
  return `${SCRATCH_KEY_PREFIX}${challengeId || 'lab'}.${sessionId}`;
}

export function isKubernetesChallenge(
  challenge: ChallengePublic | ChallengeFull | null | undefined,
): boolean {
  return (challenge?.sandboxType || '') === 'kubernetes';
}

type MainTab = 'terminal' | 'scratch';

type EvalResult = {
  passed: boolean;
  message: string;
  stdout: string;
  stderr: string;
  at: number;
};

const RESULTS_DRAWER_DEFAULT = 280;
const RESULTS_DRAWER_MIN = 140;
const RESULTS_DRAWER_MAX = 560;

export default function K8sLabWorkspace({
  challenge,
  session,
  onClose: _onClose,
}: K8sLabWorkspaceProps): JSX.Element {
  const { currentUser } = useAppState();
  const isAdmin = isAdminUser(currentUser) || isAdminUser(getCurrentUser());
  const ns = session.k8sNamespace || (session.labReady === false ? 'preparing…' : '—');
  const labReady = session.labReady !== false;
  const challengeId = challenge?.id || '';
  const shellRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const isNarrow = useIsNarrowUi();
  const [mobilePane, setMobilePane] = useState<WorkspaceMobilePane>('brief');
  const [briefCollapsed, setBriefCollapsed] = useState(false);
  const [adminEditing, setAdminEditing] = useState(false);
  const [adminWantEdit, setAdminWantEdit] = useState(false);
  const [briefPct, setBriefPct] = useState(() => {
    try {
      const raw = sessionStorage.getItem(BRIEF_PCT_KEY);
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) ? clampBriefPct(n) : DEFAULT_BRIEF_PCT;
    } catch {
      return DEFAULT_BRIEF_PCT;
    }
  });
  const [termEpoch, setTermEpoch] = useState(0);
  const [mainTab, setMainTab] = useState<MainTab>('terminal');
  const showBrief = isNarrow ? mobilePane === 'brief' : !briefCollapsed;
  const showWorkspace = isNarrow ? mobilePane === 'workspace' : true;
  const showResize = !isNarrow && !briefCollapsed;
  const [briefTab, setBriefTab] = useState<ProblemStatementTab>('description');
  const [briefChallenge, setBriefChallenge] = useState<ChallengePublic | ChallengeFull | null>(challenge);
  const [solutionFiles, setSolutionFiles] = useState<Record<string, string> | null>(null);
  const [solutionEntrypoint, setSolutionEntrypoint] = useState<string | null>(null);
  const [solutionLoading, setSolutionLoading] = useState(false);
  const [submissions, setSubmissions] = useState<K8sSubmissionRecord[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsDrawerHeight, setResultsDrawerHeight] = useState(RESULTS_DRAWER_DEFAULT);
  const resizingDrawer = useRef(false);
  const [busy, setBusy] = useState(false);
  const solutionFetchedFor = useRef<string | null>(null);
  const scratchEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [scratch, setScratch] = useState(() => {
    try {
      const raw = sessionStorage.getItem(scratchStorageKey(session.id, challengeId));
      return raw && raw.trim() ? raw : defaultScratchFor(challengeId);
    } catch {
      return defaultScratchFor(challengeId);
    }
  });

  const wsUrl = useMemo(() => {
    if (!labReady || !session.id || session.id.startsWith('pending-k8s-')) return '';
    const base = session.terminalWsUrl || k8sTerminalWsUrl(session.id);
    return `${base}${base.includes('?') ? '&' : '?'}v=${termEpoch}`;
  }, [labReady, session.terminalWsUrl, session.id, termEpoch]);

  const prevLabReady = useRef(labReady);
  useEffect(() => {
    if (labReady && !prevLabReady.current) {
      setTermEpoch((n) => n + 1);
    }
    prevLabReady.current = labReady;
  }, [labReady]);

  useEffect(() => {
    setBriefChallenge(challenge);
  }, [challenge]);

  useEffect(() => {
    if (!challenge?.id) return;
    let cancelled = false;
    void (async () => {
      try {
        const full = await fetchChallenge(challenge.id);
        if (!cancelled && full) setBriefChallenge(full);
      } catch {
        /* keep prop challenge */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [challenge?.id]);

  useEffect(() => {
    solutionFetchedFor.current = null;
    setSolutionFiles(null);
    setSolutionEntrypoint(null);
    setSolutionLoading(false);
  }, [challenge?.id]);

  useEffect(() => {
    if (briefTab !== 'solution' || !challenge?.id) return;
    if (solutionFetchedFor.current === challenge.id) return;

    let cancelled = false;
    setSolutionLoading(true);
    void (async () => {
      try {
        const payload = await fetchChallengeSolution(challenge.id);
        if (cancelled) return;
        solutionFetchedFor.current = challenge.id;
        setSolutionFiles(payload.files);
        setSolutionEntrypoint(payload.entrypoint || null);
      } catch {
        // Pack write-up (problemStatement.solution) still shows — do not blank the tab.
        if (!cancelled) solutionFetchedFor.current = challenge.id;
      } finally {
        setSolutionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [briefTab, challenge?.id]);

  const refreshSubmissions = () => {
    void fetchK8sSubmissions(session.id)
      .then((rows) => setSubmissions(rows))
      .catch(() => { /* keep last list */ });
  };

  useEffect(() => {
    setSubmissions([]);
    setSelectedSubmissionId(null);
    refreshSubmissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    try {
      sessionStorage.setItem(BRIEF_PCT_KEY, String(briefPct));
    } catch {
      /* quota */
    }
  }, [briefPct]);

  useEffect(() => {
    try {
      sessionStorage.setItem(scratchStorageKey(session.id, challengeId), scratch);
    } catch {
      /* quota */
    }
  }, [scratch, session.id, challengeId]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current && shellRef.current) {
        const rect = shellRef.current.getBoundingClientRect();
        const next = clampBriefPct(((e.clientX - rect.left) / rect.width) * 100);
        setBriefPct(next);
      }
      if (resizingDrawer.current && shellRef.current) {
        const rect = shellRef.current.getBoundingClientRect();
        const next = Math.min(
          RESULTS_DRAWER_MAX,
          Math.max(RESULTS_DRAWER_MIN, rect.bottom - e.clientY),
        );
        setResultsDrawerHeight(next);
      }
    };
    const onUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      if (resizingDrawer.current) {
        resizingDrawer.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const showEvalResult = (result: EvalResult, submissionId?: string | null) => {
    setEvalResult(result);
    if (submissionId) setSelectedSubmissionId(submissionId);
    setResultsOpen(true);
  };

  const onGrade = async () => {
    setBusy(true);
    try {
      const res = await gradeK8sSession(session.id);
      const at = Date.now();
      const result: EvalResult = {
        passed: res.passed,
        message: res.message,
        stdout: res.stdout || '',
        stderr: res.stderr || '',
        at,
      };
      if (res.submission) {
        setSubmissions((prev) => [res.submission!, ...prev.filter((s) => s.id !== res.submission!.id)]);
        showEvalResult(result, res.submission.id);
      } else {
        refreshSubmissions();
        showEvalResult(result);
      }
      setBriefTab('submissions');
    } catch (e) {
      const err = e as { response?: { data?: { error?: string; message?: string; stdout?: string; stderr?: string } }; message?: string };
      const data = err?.response?.data;
      showEvalResult({
        passed: false,
        message: data?.error || data?.message || err.message || 'submit failed',
        stdout: data?.stdout || '',
        stderr: data?.stderr || '',
        at: Date.now(),
      });
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    if (!window.confirm('Reset this lab? Workloads in your namespace will be wiped (Pods, Deployments, Services, …).')) {
      return;
    }
    setBusy(true);
    try {
      await resetK8sSession(session.id);
      setEvalResult(null);
      setResultsOpen(false);
      setSelectedSubmissionId(null);
      setScratch('');
      try {
        sessionStorage.removeItem(scratchStorageKey(session.id, challengeId));
      } catch {
        /* ignore */
      }
      setTermEpoch((n) => n + 1);
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showEvalResult({
        passed: false,
        message: err?.response?.data?.error || err.message || 'reset failed',
        stdout: '',
        stderr: '',
        at: Date.now(),
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (mainTab !== 'scratch') return;
    const id = window.requestAnimationFrame(() => {
      const ed = scratchEditorRef.current;
      if (!ed) return;
      try {
        ed.updateOptions({ readOnly: false, domReadOnly: false });
        ed.layout();
        ed.focus();
      } catch {
        /* editor disposed */
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [mainTab, resultsOpen, resultsDrawerHeight]);

  const onMonacoMount = (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
    scratchEditorRef.current = editor;
    monaco.editor.defineTheme('devlabs-k8s-scratch', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '4a5273', fontStyle: 'italic' },
        { token: 'string', foreground: '6ee7b7' },
        { token: 'number', foreground: 'fb923c' },
        { token: 'type', foreground: '93c5fd' },
        { token: 'keyword', foreground: '38bdf8' },
      ],
      colors: {
        'editor.background': '#000000',
        'editor.foreground': '#eef0ff',
        'editor.lineHighlightBackground': '#0a0a0a',
        'editorCursor.foreground': '#34d399',
        'editorIndentGuide.background': '#1a1a1a',
        'editorIndentGuide.activeBackground': '#333333',
        'editorLineNumber.foreground': '#444444',
      },
    });
    monaco.editor.setTheme('devlabs-k8s-scratch');
    editor.updateOptions({ readOnly: false, domReadOnly: false });
    window.requestAnimationFrame(() => {
      try {
        editor.layout();
        editor.focus();
      } catch {
        /* noop */
      }
    });
  };

  return (
    <div
      ref={shellRef}
      className={`workspace sandbox-workspace spark-platform-workspace k8s-lab-workspace${
        !isNarrow && briefCollapsed ? ' spark-brief-collapsed' : ''
      }${isNarrow ? ` workspace--mobile workspace--mobile-pane-${mobilePane}` : ''}`}
      style={
        isNarrow || briefCollapsed
          ? { gridTemplateColumns: 'minmax(0, 1fr)' }
          : { gridTemplateColumns: `${briefPct}% 6px minmax(0, 1fr)` }
      }
    >
      {isNarrow && (
        <WorkspaceMobileSwitcher
          pane={mobilePane}
          onChange={setMobilePane}
          briefLabel="Brief"
          workspaceLabel="Lab"
        />
      )}
      {showBrief && (
        <div className="col spark-brief-col">
          <div className="panel sandbox-brief-panel--solo spark-brief-panel--bare" style={{ flex: 1 }}>
            <div className="spark-brief-tabs" role="tablist" aria-label="Problem sections">
              <button
                type="button"
                role="tab"
                aria-selected={briefTab === 'description'}
                className={`spark-brief-tab${briefTab === 'description' ? ' active' : ''}`}
                onClick={() => setBriefTab('description')}
              >
                Description
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={briefTab === 'solution'}
                className={`spark-brief-tab${briefTab === 'solution' ? ' active' : ''}`}
                onClick={() => setBriefTab('solution')}
              >
                Solution
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={briefTab === 'submissions'}
                className={`spark-brief-tab${briefTab === 'submissions' ? ' active' : ''}`}
                onClick={() => {
                  setBriefTab('submissions');
                  refreshSubmissions();
                }}
              >
                Submissions
                {submissions.length > 0 && (
                  <span className="spark-brief-tab-count">{submissions.length}</span>
                )}
              </button>
              {isAdmin && isEditableBriefTab(briefTab) && !adminEditing && (
                <button
                  type="button"
                  className="spark-brief-edit-tab"
                  title="Edit this tab"
                  aria-label="Edit this tab"
                  onClick={() => setAdminWantEdit(true)}
                >
                  <IconPen />
                </button>
              )}
              {!isNarrow && (
                <button
                  type="button"
                  className="spark-brief-collapse-btn"
                  title="Collapse problem panel"
                  aria-label="Collapse problem panel"
                  onClick={() => setBriefCollapsed(true)}
                >
                  ⟨
                </button>
              )}
            </div>
            <div className="panel-body spark-brief-body">
              {isAdmin && isEditableBriefTab(briefTab) && (briefChallenge || challenge) && (
                <BriefAdminEditor
                  tab={briefTab}
                  challenge={(briefChallenge || challenge)!}
                  platform={null}
                  solutionFiles={solutionFiles}
                  onEditingChange={(editing) => {
                    setAdminEditing(editing);
                    if (!editing) setAdminWantEdit(false);
                  }}
                  forceEdit={adminWantEdit}
                  onSaved={({ challenge: next, solutionFiles: files }) => {
                    setBriefChallenge(next);
                    if (files) {
                      setSolutionFiles(files);
                      solutionFetchedFor.current = next.id;
                    }
                  }}
                />
              )}
              {adminEditing ? null : (
              <ProblemStatement
                challenge={briefChallenge || challenge}
                tab={briefTab}
                solutionFiles={solutionFiles}
                solutionEntrypoint={solutionEntrypoint}
                solutionLoading={solutionLoading}
                submissionsSlot={
                  briefTab === 'submissions' ? (
                    <div className="spark-submissions-list spark-submissions-list--brief">
                      {submissions.length === 0 ? (
                        <p className="dim" style={{ fontSize: 13, margin: 0 }}>
                          No submissions yet. Submit grades the cluster state for this lab.
                        </p>
                      ) : (
                        submissions.map((sub) => (
                          <div key={sub.id} className="spark-submission-card">
                            <button
                              type="button"
                              className={`spark-submission-row${
                                selectedSubmissionId === sub.id ? ' is-selected' : ''
                              }`}
                              onClick={() => {
                                showEvalResult(
                                  {
                                    passed: sub.passed,
                                    message: sub.message,
                                    stdout: sub.stdout || '',
                                    stderr: sub.stderr || '',
                                    at: sub.submittedAt || Date.now(),
                                  },
                                  sub.id,
                                );
                              }}
                            >
                              <span className="spark-submission-name">{sub.name}</span>
                              <span className="spark-submission-flags">
                                <span
                                  className={`spark-grade-badge ${
                                    sub.passed ? 'spark-grade-badge--ok' : 'spark-grade-badge--fail'
                                  }`}
                                >
                                  {sub.passed ? 'Passed' : 'Failed'}
                                </span>
                              </span>
                              <span className="spark-submission-meta-line">
                                <span className="spark-submission-time">
                                  {sub.submittedAt
                                    ? new Date(sub.submittedAt).toLocaleString(undefined, {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })
                                    : ''}
                                </span>
                                <span className="dim" style={{ fontSize: 12 }}>
                                  {sub.message}
                                </span>
                              </span>
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  ) : null
                }
              />
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
          aria-label="Resize problem panel"
          onMouseDown={() => {
            dragging.current = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
          onDoubleClick={() => {
            setBriefPct(DEFAULT_BRIEF_PCT);
          }}
        />
      )}

      {!isNarrow && briefCollapsed && (
        <button
          type="button"
          className="spark-brief-reopen-float"
          title="Show problem panel"
          aria-label="Show problem panel"
          onClick={() => setBriefCollapsed(false)}
        >
          ⟩
        </button>
      )}

      {showWorkspace && (
      <div className="col col-main">
        <div className="panel spark-ide-panel" style={{ flex: 1 }}>
          <div className="spark-ide-actionbar">
            <div className="spark-ide-actionbar-left">
              <div className="k8s-lab-main-tabs" role="tablist" aria-label="Lab workspace">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mainTab === 'terminal'}
                  className={`k8s-lab-main-tab${mainTab === 'terminal' ? ' active' : ''}`}
                  onClick={() => setMainTab('terminal')}
                >
                  Terminal
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mainTab === 'scratch'}
                  className={`k8s-lab-main-tab${mainTab === 'scratch' ? ' active' : ''}`}
                  onClick={() => setMainTab('scratch')}
                >
                  Scratch pad
                </button>
              </div>
              <span className="k8s-lab-ns-chip" title="Your lab namespace">
                ns <code>{ns}</code>
              </span>
              {evalResult && (
                <span
                  className={`k8s-lab-grade-chip${evalResult.passed ? ' is-pass' : ' is-fail'}`}
                  title={evalResult.message}
                >
                  {evalResult.passed ? 'PASS' : 'FAIL'}
                </span>
              )}
            </div>
            <div className="spark-ide-actionbar-right">
              <button
                type="button"
                className="spark-ide-btn spark-ide-btn--run"
                disabled={busy || !labReady}
                onClick={() => void onReset()}
                title={labReady ? 'Reset workloads in your namespace' : 'Lab is still preparing'}
              >
                Reset
              </button>
              <button
                type="button"
                className="spark-ide-btn spark-ide-btn--submit"
                disabled={busy || !labReady}
                onClick={() => void onGrade()}
                title={labReady ? 'Submit for grading' : 'Lab is still preparing'}
              >
                <IconSubmit color="#04120c" />
                <span>{busy ? 'Submitting…' : 'Submit'}</span>
              </button>
            </div>
          </div>

          <div
            className={[
              'panel-body flush k8s-lab-term-pane',
              resultsOpen && evalResult ? 'k8s-lab-term-pane--results-open' : '',
              !resultsOpen && evalResult ? 'k8s-lab-term-pane--has-results-bar' : '',
            ].filter(Boolean).join(' ')}
            style={
              resultsOpen && evalResult
                ? ({ '--k8s-results-h': `${resultsDrawerHeight}px` } as React.CSSProperties)
                : undefined
            }
          >
            <div
              className={`k8s-lab-term-pane-layer${mainTab === 'terminal' ? ' is-active' : ''}`}
              aria-hidden={mainTab !== 'terminal'}
            >
              {!labReady ? (
                <div className="k8s-lab-terminal-warming" role="status" aria-live="polite">
                  <span className="spinner" />
                  <div>
                    <strong>Preparing your cluster terminal…</strong>
                    <p>
                      Read the problem on the left — namespace and shell unlock when the lab is ready.
                    </p>
                  </div>
                </div>
              ) : (
                <TerminalPanel wsUrl={wsUrl} isActive={mainTab === 'terminal'} resizeProtocol />
              )}
            </div>
            <div
              className={`k8s-lab-scratch${mainTab === 'scratch' ? ' is-active' : ''}`}
              aria-hidden={mainTab !== 'scratch'}
            >
              <p className="k8s-lab-scratch-hint">
                Draft YAML here, then in Terminal save and apply — e.g.
                {' '}
                <code>cat &gt; manifest.yaml</code>
                , paste, Ctrl-D, then
                {' '}
                <code>kubectl apply -f manifest.yaml</code>
                .
              </p>
              <div className="k8s-lab-scratch-editor">
                <MonacoEditor
                  height="100%"
                  language="yaml"
                  theme="devlabs-k8s-scratch"
                  value={scratch}
                  onChange={(v) => setScratch(v ?? '')}
                  onMount={onMonacoMount}
                  options={{
                    readOnly: false,
                    domReadOnly: false,
                    fontSize: 13,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    tabSize: 2,
                    insertSpaces: true,
                    automaticLayout: true,
                    renderWhitespace: 'selection',
                    padding: { top: 12, bottom: 12 },
                  }}
                />
              </div>
            </div>

            {!resultsOpen && evalResult && (
              <button
                type="button"
                className="spark-results-reopen"
                onClick={() => setResultsOpen(true)}
                title="Show result"
              >
                <span>Result</span>
                <span
                  className={`spark-grade-badge ${
                    evalResult.passed ? 'spark-grade-badge--ok' : 'spark-grade-badge--fail'
                  }`}
                >
                  {evalResult.passed ? 'Passed' : 'Failed'}
                </span>
                <span className="spark-results-reopen-chevron" aria-hidden>
                  ⌃
                </span>
              </button>
            )}

            {resultsOpen && evalResult && (
              <div
                className="spark-job-drawer spark-results-drawer"
                style={{ height: resultsDrawerHeight }}
              >
                <div
                  className="spark-job-drawer-resize"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize results"
                  title="Drag to resize"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    resizingDrawer.current = true;
                    document.body.style.cursor = 'row-resize';
                    document.body.style.userSelect = 'none';
                  }}
                  onDoubleClick={() => setResultsDrawerHeight(RESULTS_DRAWER_DEFAULT)}
                />
                <div className="spark-job-drawer-header spark-results-tabs-header">
                  <div className="spark-results-tabs" aria-label="Results">
                    <span className="spark-results-tab active">Result</span>
                  </div>
                  <div className="spark-results-header-right">
                    <div className="spark-results-meta">
                      <span
                        className={`spark-grade-badge ${
                          evalResult.passed ? 'spark-grade-badge--ok' : 'spark-grade-badge--fail'
                        }`}
                      >
                        {evalResult.passed ? 'Passed' : 'Failed'}
                      </span>
                      <span className="spark-results-exec">
                        {new Date(evalResult.at).toLocaleTimeString()}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="spark-results-close"
                      onClick={() => setResultsOpen(false)}
                      title="Close results"
                      aria-label="Close results"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="spark-job-drawer-body k8s-lab-eval-drawer-body">
                  <div className={`k8s-lab-eval-banner${evalResult.passed ? ' is-pass' : ' is-fail'}`}>
                    <strong>{evalResult.passed ? 'PASS' : 'FAIL'}</strong>
                    <span>{evalResult.message}</span>
                  </div>
                  {(evalResult.stdout || evalResult.stderr) && (
                    <div className="k8s-lab-eval-body">
                      {evalResult.stdout ? (
                        <section>
                          <h3>stdout</h3>
                          <pre>{evalResult.stdout}</pre>
                        </section>
                      ) : null}
                      {evalResult.stderr ? (
                        <section>
                          <h3>stderr</h3>
                          <pre className="k8s-lab-eval-stderr">{evalResult.stderr}</pre>
                        </section>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
