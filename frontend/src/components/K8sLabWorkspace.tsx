import React, { useEffect, useMemo, useRef, useState } from 'react';
import ProblemStatement from './ProblemStatement';
import K8sLabFileEditor from './K8sLabFileEditor';
import BriefAdminEditor, { isEditableBriefTab } from './BriefAdminEditor';
import ChallengeVisibilityPanel from './ChallengeVisibilityPanel';
import ChallengeReviewPanel from './ChallengeReviewPanel';
import TerminalPanel from './TerminalPanel';
import SolutionGateModal, { hasAcknowledgedSolution } from './SolutionGateModal';
import ConfirmDialog from './ConfirmDialog';
import BriefBackButton from './BriefBackButton';
import WorkspaceMobileSwitcher, { type WorkspaceMobilePane } from './WorkspaceMobileSwitcher';
import DesktopOnlyNotice from './DesktopOnlyNotice';
import { IconPen, IconSubmit } from './ChromeIcons';
import { useIsNarrowUi } from '../hooks/useMediaQuery';
import { fetchChallenge, fetchChallengeSolution } from '../services/challengeApi';
import { isAdminUser, isReviewStaff, getCurrentUser } from '../services/authApi';
import { readMigrating, writeMigrating } from '../utils/storageMigrate';
import {
  LAB_LEASE_RECLAIMED_EVENT,
  LAB_LEASE_TAKEN_EVENT,
  LAB_SESSION_ENDED_EVENT,
  sendLabHeartbeat,
  withLabClientId,
} from '../services/labTabLease';
import {
  fetchK8sCapacity,
  fetchK8sSubmissions,
  gradeK8sSession,
  resetK8sSession,
  type K8sCapacityState,
  type K8sSubmissionRecord,
} from '../services/workspaceApi';
import type { ActiveSession, ChallengeFull, ChallengePublic } from '../types/domain';
import type { ProblemStatementTab } from './ProblemStatement';
import { useAppState } from '../context/AppStateContext';

interface K8sLabWorkspaceProps {
  challenge: ChallengePublic | ChallengeFull | null;
  session: ActiveSession;
  onClose: () => void;
}

const BRIEF_PCT_KEY = 'devsetu.k8sLab.briefPct.v1';
const LEGACY_BRIEF_PCT_KEY = 'devlabs.k8sLab.briefPct.v1';
/** Description share of the workspace shell (terminal gets the rest). */
const DEFAULT_BRIEF_PCT = 45;
const MIN_BRIEF_PCT = 22;
const MAX_BRIEF_PCT = 70;

function clampBriefPct(pct: number): number {
  return Math.min(MAX_BRIEF_PCT, Math.max(MIN_BRIEF_PCT, Math.round(pct)));
}

function k8sTerminalWsUrl(sessionId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws/k8s-terminal?sessionId=${sessionId}`;
}

/**
 * Cluster labs (sandboxType kubernetes, linux or docker) share this workspace and the
 * kubernetes session runtime; Linux and Docker labs are a single machine with a shell.
 */
export function isKubernetesChallenge(
  challenge: ChallengePublic | ChallengeFull | null | undefined,
): boolean {
  const t = challenge?.sandboxType || '';
  return t === 'kubernetes' || t === 'linux' || t === 'docker';
}

/** Linux and Docker labs: one machine per learner, no namespace or Editor. */
export function isBoxChallenge(
  challenge: ChallengePublic | ChallengeFull | null | undefined,
): boolean {
  const t = challenge?.sandboxType || '';
  return t === 'linux' || t === 'docker';
}

export function boxMachineLabel(
  challenge: ChallengePublic | ChallengeFull | null | undefined,
): string {
  return challenge?.sandboxType === 'docker' ? 'Docker' : 'Linux';
}

type MainTab = 'terminal' | 'editor';

type EvalResult = {
  passed: boolean;
  message: string;
  stdout: string;
  stderr: string;
  at: number;
};

const CAPACITY_POLL_MS = 3000;
/** Typical Karpenter node boot, shown to learners as the expected wait. */
const NODE_BOOT_SECONDS = 40;

/** Poll capacity waits (lab open held, pods waiting for a node) while the lab is open. */
function useCapacity(enabled: boolean): K8sCapacityState {
  const [state, setState] = useState<K8sCapacityState>({ waiting: [], reservingSeconds: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async (): Promise<void> => {
      try {
        const next = await fetchK8sCapacity();
        if (!cancelled) setState(next);
      } catch {
        /* keep the last value; the notice is best-effort */
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), CAPACITY_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);
  return state;
}

function capacityEta(waitedSeconds: number): string {
  const left = NODE_BOOT_SECONDS - waitedSeconds;
  return left > 5 ? `about ${left} s` : 'a few more seconds';
}

const RESULTS_DRAWER_DEFAULT = 280;
const RESULTS_DRAWER_MIN = 140;
const RESULTS_DRAWER_MAX = 560;

export default function K8sLabWorkspace({
  challenge,
  session,
  onClose: _onClose,
}: K8sLabWorkspaceProps): JSX.Element {
  const { currentUser, onSelectChallenge } = useAppState();
  const isAdmin = isAdminUser(currentUser) || isAdminUser(getCurrentUser());
  const showReviewTab = isReviewStaff(currentUser) || isReviewStaff(getCurrentUser());
  const labReady = session.labReady !== false;
  const lockedMessage = session.lockedMessage || null;
  const notReadyTitle = lockedMessage ? 'Lab is unavailable right now' : 'Lab is still preparing';
  const challengeId = challenge?.id || '';
  const box = isBoxChallenge(challenge);
  const machineLabel = boxMachineLabel(challenge);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const isNarrow = useIsNarrowUi();
  const [mobilePane, setMobilePane] = useState<WorkspaceMobilePane>('brief');
  const [briefCollapsed, setBriefCollapsed] = useState(false);
  const [adminEditing, setAdminEditing] = useState(false);
  const [adminWantEdit, setAdminWantEdit] = useState(false);
  const [briefPct, setBriefPct] = useState(() => {
    try {
      const raw = readMigrating(sessionStorage, BRIEF_PCT_KEY, LEGACY_BRIEF_PCT_KEY);
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) ? clampBriefPct(n) : DEFAULT_BRIEF_PCT;
    } catch {
      return DEFAULT_BRIEF_PCT;
    }
  });
  const [termEpoch, setTermEpoch] = useState(0);
  // Editor first so the lab is usable instantly; the terminal connects in the background.
  // Box labs (Linux, Docker) have no Editor: files are edited on the machine itself.
  const [mainTab, setMainTab] = useState<MainTab>(box ? 'terminal' : 'editor');
  const showBrief = isNarrow ? mobilePane === 'brief' : !briefCollapsed;
  const showWorkspace = isNarrow ? mobilePane === 'workspace' : true;
  const showResize = !isNarrow && !briefCollapsed;
  const [briefTab, setBriefTab] = useState<ProblemStatementTab>('description');
  const [briefChallenge, setBriefChallenge] = useState<ChallengePublic | ChallengeFull | null>(challenge);
  const isPractice = Boolean((briefChallenge || challenge)?.k8sPlatform?.practice);
  const [solutionFiles, setSolutionFiles] = useState<Record<string, string> | null>(null);
  const [solutionEntrypoint, setSolutionEntrypoint] = useState<string | null>(null);
  const [solutionLoading, setSolutionLoading] = useState(false);
  const [solutionGateOpen, setSolutionGateOpen] = useState(false);
  const [submissions, setSubmissions] = useState<K8sSubmissionRecord[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsDrawerHeight, setResultsDrawerHeight] = useState(RESULTS_DRAWER_DEFAULT);
  const resizingDrawer = useRef(false);
  const [busy, setBusy] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const capacity = useCapacity(!box && !lockedMessage);
  const capacityWaits = capacity.waiting;
  const capacityWaitedSeconds = Math.max(
    capacity.reservingSeconds ?? 0,
    ...capacityWaits.map((w) => w.waitingSeconds),
  );
  const openingHeldForCapacity = capacity.reservingSeconds !== null || capacityWaits.length > 0;

  const wsUrl = useMemo(() => {
    if (!labReady || !session.id || session.id.startsWith('pending-k8s-')) return '';
    const base = withLabClientId(session.terminalWsUrl || k8sTerminalWsUrl(session.id));
    return `${base}&v=${termEpoch}`;
  }, [labReady, session.terminalWsUrl, session.id, termEpoch]);

  useEffect(() => {
    const onReclaimed = (): void => setTermEpoch((n) => n + 1);
    window.addEventListener(LAB_LEASE_RECLAIMED_EVENT, onReclaimed);
    return () => window.removeEventListener(LAB_LEASE_RECLAIMED_EVENT, onReclaimed);
  }, []);

  const onTerminalDisconnect = (): void => {
    if (!session.id || session.id.startsWith('pending-k8s-')) return;
    void sendLabHeartbeat(session.id).then((result) => {
      if (result === 'taken') window.dispatchEvent(new Event(LAB_LEASE_TAKEN_EVENT));
      if (result === 'ended') window.dispatchEvent(new Event(LAB_SESSION_ENDED_EVENT));
    });
  };

  useEffect(() => {
    if (lockedMessage) setMainTab('terminal');
  }, [lockedMessage]);

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
    setSolutionFiles(null);
    setSolutionEntrypoint(null);
    setSolutionLoading(false);
  }, [challenge?.id]);

  useEffect(() => {
    if (isPractice && briefTab !== 'description') setBriefTab('description');
  }, [isPractice, briefTab]);

  useEffect(() => {
    if (briefTab !== 'solution' || !challenge?.id) return;

    let cancelled = false;
    setSolutionLoading(true);
    void (async () => {
      try {
        const payload = await fetchChallengeSolution(challenge.id);
        if (cancelled) return;
        setSolutionFiles(payload.files);
        setSolutionEntrypoint(payload.entrypoint || null);
      } catch {
        // Pack write-up (problemStatement.solution) still shows — do not blank the tab.
        if (!cancelled) {
          setSolutionFiles(null);
          setSolutionEntrypoint(null);
        }
      } finally {
        if (!cancelled) setSolutionLoading(false);
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
      writeMigrating(sessionStorage, BRIEF_PCT_KEY, LEGACY_BRIEF_PCT_KEY, String(briefPct));
    } catch {
      /* quota */
    }
  }, [briefPct]);

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
    setResetConfirmOpen(false);
    setBusy(true);
    try {
      await resetK8sSession(session.id);
      setEvalResult(null);
      setResultsOpen(false);
      setSelectedSubmissionId(null);
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
    if (box) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '`' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      setMainTab((tab) => (tab === 'editor' ? 'terminal' : 'editor'));
    };
    // Capture phase: xterm swallows keystrokes once the terminal has focus.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [box]);

  const toggleHint = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘`' : 'Ctrl+`';

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
              <BriefBackButton />
              <button
                type="button"
                role="tab"
                aria-selected={briefTab === 'description'}
                className={`spark-brief-tab${briefTab === 'description' ? ' active' : ''}`}
                onClick={() => setBriefTab('description')}
              >
                Description
              </button>
              {!isPractice && (
              <button
                type="button"
                role="tab"
                aria-selected={briefTab === 'solution'}
                className={`spark-brief-tab${briefTab === 'solution' ? ' active' : ''}`}
                onClick={() => {
                  if (hasAcknowledgedSolution(challengeId)) {
                    setBriefTab('solution');
                  } else {
                    setSolutionGateOpen(true);
                  }
                }}
              >
                Solution
              </button>
              )}
              {!isPractice && (
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
              )}
              {isAdmin ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={briefTab === 'visibility'}
                  className={`spark-brief-tab spark-brief-tab--setter${briefTab === 'visibility' ? ' active' : ''}`}
                  onClick={() => setBriefTab('visibility')}
                >
                  Visibility
                </button>
              ) : null}
              {showReviewTab ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={briefTab === 'review'}
                  className={`spark-brief-tab spark-brief-tab--setter${briefTab === 'review' ? ' active' : ''}`}
                  onClick={() => setBriefTab('review')}
                >
                  Review
                </button>
              ) : null}
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
                    if (files) setSolutionFiles(files);
                  }}
                />
              )}
              {adminEditing ? null : briefTab === 'visibility' && isAdmin && (briefChallenge || challenge) ? (
                <ChallengeVisibilityPanel
                  challengeId={(briefChallenge || challenge)!.id}
                  visibleTo={((briefChallenge || challenge)!.visibleTo as 'admin' | 'users' | 'reviewers') || 'admin'}
                  visibilityNotes={(briefChallenge || challenge)!.visibilityNotes || ''}
                  tokens={
                    typeof (briefChallenge || challenge)!.tokens === 'number'
                      ? (briefChallenge || challenge)!.tokens
                      : 10
                  }
                  onSaved={({ visibleTo, visibilityNotes, tokens }) => {
                    setBriefChallenge({
                      ...(briefChallenge || challenge)!,
                      visibleTo,
                      visibilityNotes,
                      tokens,
                    } as ChallengeFull);
                  }}
                />
              ) : briefTab === 'review' && showReviewTab && (briefChallenge || challenge) ? (
                <ChallengeReviewPanel challengeId={(briefChallenge || challenge)!.id} />
              ) : (
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
                          No submissions yet. Submit grades the {box ? 'state of your machine' : 'cluster state'} for this lab.
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

      {showWorkspace && isNarrow && (
        <DesktopOnlyNotice tools="terminal and editor" onShowBrief={() => setMobilePane('brief')} />
      )}
      {showWorkspace && !isNarrow && (
      <div className="col col-main">
        <div className="panel spark-ide-panel" style={{ flex: 1 }}>
          <div className="spark-ide-actionbar">
            <div className="spark-ide-actionbar-left">
              <div className="k8s-lab-main-tabs" role="tablist" aria-label="Lab workspace">
                {!box && !lockedMessage && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={mainTab === 'editor'}
                  className={`k8s-lab-main-tab${mainTab === 'editor' ? ' active' : ''}`}
                  onClick={() => setMainTab('editor')}
                  title={`Editor (${toggleHint} to toggle)`}
                >
                  Editor
                </button>
                )}
                <button
                  type="button"
                  role="tab"
                  aria-selected={mainTab === 'terminal'}
                  className={`k8s-lab-main-tab${mainTab === 'terminal' ? ' active' : ''}`}
                  onClick={() => setMainTab('terminal')}
                  title={
                    lockedMessage
                      ? 'Terminal is unavailable right now'
                      : labReady
                        ? (box ? 'Terminal' : `Terminal (${toggleHint} to toggle)`)
                        : 'Terminal is connecting in the background'
                  }
                >
                  Terminal
                  <span
                    className={`k8s-lab-term-status${labReady ? ' is-ready' : ''}${lockedMessage ? ' is-locked' : ''}`}
                    aria-label={lockedMessage ? 'unavailable' : labReady ? 'ready' : 'connecting'}
                  />
                </button>
              </div>
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
                onClick={() => setResetConfirmOpen(true)}
                title={
                  !labReady
                    ? notReadyTitle
                    : box ? 'Start over on a fresh machine' : 'Reset workloads in your namespace'
                }
              >
                Reset
              </button>
              {isPractice ? (
                <span
                  className="k8s-lab-practice-chip"
                  title="Hands-on practice: explore freely, there is nothing to submit"
                >
                  Practice lab · no submission
                </span>
              ) : (
                <button
                  type="button"
                  className="spark-ide-btn spark-ide-btn--submit"
                  disabled={busy || !labReady}
                  onClick={() => void onGrade()}
                  title={labReady ? 'Submit for grading' : notReadyTitle}
                >
                  <IconSubmit color="#04120c" />
                  <span>{busy ? 'Submitting…' : 'Submit'}</span>
                </button>
              )}
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
              {lockedMessage ? (
                <div className="k8s-lab-locked" role="status" aria-live="polite">
                  <svg className="k8s-lab-locked-icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
                    <rect x="4.5" y="10.5" width="15" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                  <strong>This lab is locked for now</strong>
                  <p>{lockedMessage}</p>
                  <p className="k8s-lab-locked-hint">
                    You can still read the description and the rest of the brief on the left.
                  </p>
                  {challenge && (
                    <button
                      type="button"
                      className="spark-ide-btn k8s-lab-locked-retry"
                      onClick={() => void onSelectChallenge(challenge)}
                    >
                      Try again
                    </button>
                  )}
                </div>
              ) : !labReady ? (
                <div className="k8s-lab-terminal-warming" role="status" aria-live="polite">
                  <span className="spinner" />
                  <div>
                    {box ? (
                      <>
                        <strong>Starting your {machineLabel} machine…</strong>
                        <p>
                          A fresh machine is booting for you. This usually takes a few seconds, and up to
                          two minutes when a new server has to start first.
                        </p>
                      </>
                    ) : openingHeldForCapacity ? (
                      <>
                        <strong>Adding cluster capacity for your lab…</strong>
                        <p>
                          The cluster is busy, so a node is starting for your lab&apos;s pods
                          ({capacityEta(capacityWaitedSeconds)}). The shell opens here as soon as they are placed.
                        </p>
                      </>
                    ) : (
                      <>
                        <strong>Preparing your cluster terminal…</strong>
                        <p>
                          Keep drafting in the Editor — the shell opens here as soon as your namespace is ready.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {capacityWaits.length > 0 && (
                    <div className="k8s-lab-capacity-notice" role="status" aria-live="polite">
                      <span className="spinner" />
                      <span>
                        Starting extra capacity for{' '}
                        <code>{capacityWaits.map((w) => w.pod).join(', ')}</code>
                        {' '}— {capacityEta(capacityWaitedSeconds)}. Your lab&apos;s reserved pods are in use;
                        this starts automatically and your other pods are unaffected.
                      </span>
                    </div>
                  )}
                  <TerminalPanel
                    wsUrl={wsUrl}
                    isActive={mainTab === 'terminal'}
                    resizeProtocol
                    onDisconnect={onTerminalDisconnect}
                  />
                </>
              )}
            </div>
            {!box && (
            <div
              className={`k8s-lab-scratch${mainTab === 'editor' ? ' is-active' : ''}`}
              aria-hidden={mainTab !== 'editor'}
            >
              <K8sLabFileEditor
                sessionId={session.id}
                challengeId={challengeId}
                labReady={labReady}
                active={mainTab === 'editor'}
                toggleHint={toggleHint}
              />
            </div>
            )}

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
      <SolutionGateModal
        open={solutionGateOpen}
        challengeId={challengeId}
        onCancel={() => setSolutionGateOpen(false)}
        onConfirm={() => {
          setSolutionGateOpen(false);
          setBriefTab('solution');
        }}
      />
      <ConfirmDialog
        open={resetConfirmOpen}
        title="Reset this lab?"
        confirmLabel="Reset lab"
        cancelLabel="Cancel"
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={() => void onReset()}
      >
        {box ? (
          <p>
            Your machine is replaced with a fresh one and the lab&apos;s starting state is set up again.
            Everything you changed on it, including files in your home folder, is lost.
          </p>
        ) : (
          <>
            <p>
              Everything running in your namespace is wiped (Pods, Deployments, Services, ConfigMaps,
              volumes, …) and the lab&apos;s starting state is set up again.
            </p>
            <p>
              Your code and config files are <strong>not</strong> touched. Anything you created in the
              Editor or your home folder stays, so you can <code>kubectl apply -f</code> it again.
            </p>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
