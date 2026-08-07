import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ProblemStatement from './ProblemStatement';
import SparkProjectEditor from './SparkProjectEditor';
import {
  type SparkProjectFiles,
} from '../fixtures/dailyProductSalesL1';
import { useRegisterPlayChrome } from '../context/PlayChromeContext';
import { ChromeIconButton } from './ChromeIcons';
import { useWorkspaceSync } from '../hooks/useWorkspaceSync';
import {
  fetchSparkJob,
  fetchSparkJobs,
  fetchSparkSubmissions,
  fetchWorkspace,
  startSparkJob,
} from '../services/workspaceApi';
import type {
  ActiveSession,
  ChallengeFull,
  ChallengePublic,
  SparkJobRecord,
  SparkJobStatus,
  SparkPlatformSpec,
} from '../types/domain';

const BRIEF_MIN = 280;
const BRIEF_RATIO = 0.35;
const BRIEF_MAX_RATIO = 0.7;
const JOB_POLL_MS = 4000;
const JOB_POLL_MAX_MS = 15 * 60 * 1000;
const SUBMISSIONS_PAGE_SIZE = 5;
const JOB_DRAWER_MIN = 140;
const JOB_DRAWER_DEFAULT = 280;

function clampBriefWidth(width: number, shellWidth: number): number {
  const max = Math.max(BRIEF_MIN, Math.floor(shellWidth * BRIEF_MAX_RATIO));
  return Math.min(max, Math.max(BRIEF_MIN, Math.round(width)));
}

function defaultBriefWidth(shellWidth: number): number {
  return clampBriefWidth(shellWidth * BRIEF_RATIO, shellWidth);
}

interface SparkPlatformWorkspaceProps {
  challenge: ChallengePublic | ChallengeFull | null | undefined;
  session: ActiveSession | null;
  onClose?: () => void;
}

function isSparkChallenge(
  challenge: ChallengePublic | ChallengeFull | null | undefined,
): challenge is ChallengeFull {
  return Boolean(challenge && (challenge as ChallengeFull).sparkPlatform);
}

function statusClass(status: SparkJobStatus): string {
  if (status === 'succeeded') return 'spark-job-status--ok';
  if (status === 'failed') return 'spark-job-status--fail';
  if (status === 'running' || status === 'queued' || status === 'submitted') {
    return 'spark-job-status--run';
  }
  return '';
}

function isTerminalStatus(status: SparkJobStatus): boolean {
  return status === 'succeeded' || status === 'failed';
}

function isJobSettled(job: SparkJobRecord): boolean {
  if (!isTerminalStatus(job.status)) return false;
  if (job.mode === 'submit') {
    const g = job.gradeStatus;
    if (!g || g === 'pending' || g === 'grading') return false;
  }
  return true;
}

function gradeBadge(job: SparkJobRecord): string {
  if (job.mode !== 'submit') return '';
  if (job.gradeStatus === 'passed') return 'PASSED';
  if (job.gradeStatus === 'failed') return 'FAILED';
  if (job.gradeStatus === 'grading' || job.gradeStatus === 'pending') return 'GRADING';
  return '';
}

function SparkDebugMeta({ job }: { job: SparkJobRecord }): JSX.Element | null {
  if (!job.applicationId && !job.historyUrl) return null;
  return (
    <div className="spark-job-debug" onClick={(e) => e.stopPropagation()}>
      <div className="spark-job-debug-row">
        <span className="spark-job-debug-label">Application ID</span>
        <code className="spark-job-debug-value">
          {job.applicationId || 'pending…'}
        </code>
      </div>
      {job.historyUrl && (
        <div className="spark-job-debug-row">
          <span className="spark-job-debug-label">History</span>
          <a
            className="spark-job-debug-link"
            href={job.historyUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={job.historyUrl}
          >
            {job.applicationId ? job.historyUrl : 'History Server'}
          </a>
        </div>
      )}
    </div>
  );
}

export default function SparkPlatformWorkspace({
  challenge,
  session,
}: SparkPlatformWorkspaceProps): JSX.Element | null {
  const platform = isSparkChallenge(challenge) ? challenge.sparkPlatform ?? null : null;

  const [files, setFiles] = useState<SparkProjectFiles>({});
  const [jobs, setJobs] = useState<SparkJobRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showJobPanel, setShowJobPanel] = useState(false);
  const [showSubmissions, setShowSubmissions] = useState(false);
  const [submissions, setSubmissions] = useState<SparkJobRecord[]>([]);
  const [submissionsPage, setSubmissionsPage] = useState(0);
  const [jobDrawerHeight, setJobDrawerHeight] = useState(JOB_DRAWER_DEFAULT);
  const [briefWidth, setBriefWidth] = useState(() =>
    typeof window !== 'undefined' ? defaultBriefWidth(window.innerWidth) : 480,
  );
  const [briefCollapsed, setBriefCollapsed] = useState(false);
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null);
  const dragging = useRef(false);
  const resizingDrawer = useRef(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const ideBodyRef = useRef<HTMLDivElement | null>(null);
  const pollTimers = useRef<Map<string, number>>(new Map());

  const syncEnabled = Boolean(session?.id && session.runtime === 'spark-platform');
  const {
    syncStatus,
    syncError,
    resetBaseline,
    trackContentChange,
    flush,
    notifyCreated,
    notifyDeleted,
    notifyRenamed,
  } = useWorkspaceSync({
    sessionId: session?.id,
    enabled: syncEnabled,
  });

  const stopPolling = useCallback((jobId: string) => {
    const t = pollTimers.current.get(jobId);
    if (t != null) {
      window.clearTimeout(t);
      pollTimers.current.delete(jobId);
    }
  }, []);

  const upsertJob = useCallback((job: SparkJobRecord) => {
    setJobs((prev) => {
      const rest = prev.filter((j) => j.id !== job.id && !j.id.startsWith('pending-'));
      return [job, ...rest];
    });
  }, []);

  const pollJob = useCallback((sessionId: string, jobId: string, startedAt: number) => {
    stopPolling(jobId);
    const tick = async () => {
      try {
        const job = await fetchSparkJob(sessionId, jobId);
        upsertJob(job);
        if (job.mode === 'submit') {
          setSubmissions((prev) => {
            const rest = prev.filter((j) => j.id !== job.id);
            return [job, ...rest].sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
          });
        }
        if (isJobSettled(job) || Date.now() - startedAt > JOB_POLL_MAX_MS) {
          stopPolling(jobId);
          return;
        }
      } catch (_e) {
        if (Date.now() - startedAt > JOB_POLL_MAX_MS) {
          stopPolling(jobId);
          return;
        }
      }
      const handle = window.setTimeout(() => { void tick(); }, JOB_POLL_MS);
      pollTimers.current.set(jobId, handle);
    };
    const handle = window.setTimeout(() => { void tick(); }, JOB_POLL_MS);
    pollTimers.current.set(jobId, handle);
  }, [stopPolling, upsertJob]);

  useEffect(() => {
    return () => {
      for (const t of pollTimers.current.values()) window.clearTimeout(t);
      pollTimers.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!platform || !session?.id) return;
    let cancelled = false;

    (async () => {
      setJobs([]);
      setShowJobPanel(false);
      setWorkspaceLoadError(null);
      setFiles({});
      if (!syncEnabled) {
        setWorkspaceLoadError('Spark session missing — cannot load workspace from MinIO');
        return;
      }
      try {
        const remote = await fetchWorkspace(session.id);
        if (cancelled) return;
        if (!remote.files || Object.keys(remote.files).length === 0) {
          setWorkspaceLoadError('Workspace is empty in MinIO');
          return;
        }
        setFiles(remote.files);
        resetBaseline(remote.files);
        try {
          const existing = await fetchSparkJobs(session.id);
          if (!cancelled && existing.length) {
            setJobs(existing);
            for (const j of existing) {
              if (!isJobSettled(j)) {
                pollJob(session.id, j.id, j.submittedAt || Date.now());
              }
            }
          }
          const subs = await fetchSparkSubmissions(session.id);
          if (!cancelled) setSubmissions(subs);
        } catch (_e) { /* jobs list optional on open */ }
      } catch (e) {
        if (cancelled) return;
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        setWorkspaceLoadError(
          err?.response?.data?.error || err.message || 'Failed to load workspace from MinIO',
        );
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, session?.id, syncEnabled]);

  const onResizeMove = useCallback((e: MouseEvent) => {
    if (dragging.current && shellRef.current) {
      const rect = shellRef.current.getBoundingClientRect();
      const next = e.clientX - rect.left;
      setBriefWidth(clampBriefWidth(next, rect.width));
    }
    if (resizingDrawer.current && ideBodyRef.current) {
      const rect = ideBodyRef.current.getBoundingClientRect();
      const next = rect.bottom - e.clientY;
      const max = Math.max(JOB_DRAWER_MIN, Math.floor(rect.height * 0.9));
      setJobDrawerHeight(Math.min(max, Math.max(JOB_DRAWER_MIN, next)));
    }
  }, []);

  const onResizeEnd = useCallback(() => {
    dragging.current = false;
    resizingDrawer.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent) => onResizeMove(e);
    const up = () => onResizeEnd();
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [onResizeMove, onResizeEnd]);

  useEffect(() => {
    const shellWidth = shellRef.current?.getBoundingClientRect().width || window.innerWidth;
    setBriefWidth(defaultBriefWidth(shellWidth));
  }, [challenge?.id]);

  const latestJob = jobs[0] || null;

  const submissionsPageCount = Math.max(1, Math.ceil(submissions.length / SUBMISSIONS_PAGE_SIZE));
  const safeSubmissionsPage = Math.min(submissionsPage, submissionsPageCount - 1);
  const pagedSubmissions = useMemo(() => {
    const start = safeSubmissionsPage * SUBMISSIONS_PAGE_SIZE;
    return submissions.slice(start, start + SUBMISSIONS_PAGE_SIZE);
  }, [submissions, safeSubmissionsPage]);

  useEffect(() => {
    if (submissionsPage > submissionsPageCount - 1) {
      setSubmissionsPage(Math.max(0, submissionsPageCount - 1));
    }
  }, [submissionsPage, submissionsPageCount]);

  const launchJob = useCallback(async (mode: 'run' | 'submit') => {
    if (submitting || !platform || !session?.id) return;
    setSubmitting(true);
    setShowJobPanel(true);
    try {
      await flush();
    } catch (_e) { /* keep going with last synced files */ }

    const pendingId = `pending-${Date.now()}`;
    const pending: SparkJobRecord = {
      id: pendingId,
      name: mode === 'run' ? 'running…' : 'submitting…',
      status: 'submitted',
      submittedAt: Date.now(),
      logs: [
        'Flushing workspace to MinIO…',
        'Snapshotting project and submitting SparkApplication…',
      ],
    };
    setJobs((prev) => [pending, ...prev]);

    try {
      const job = await startSparkJob(session.id, {
        mode,
        inputPath: platform.inputPath,
        businessDate: platform.businessDate,
        evalSolutionPath: platform.evalSolutionPath,
        limits: platform.limits,
      });
      upsertJob(job);
      if (job.mode === 'submit') {
        setSubmissions((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
      }
      if (!isJobSettled(job)) {
        pollJob(session.id, job.id, job.submittedAt || Date.now());
      }
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      const failed: SparkJobRecord = {
        id: pendingId,
        name: mode === 'run' ? 'run-failed' : 'submit-failed',
        status: 'failed',
        submittedAt: Date.now(),
        finishedAt: Date.now(),
        logs: pending.logs,
        error: err?.response?.data?.error || err.message || 'Failed to start Spark job',
      };
      setJobs((prev) => [failed, ...prev.filter((j) => j.id !== pendingId)]);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, platform, session?.id, flush, upsertJob, pollJob]);

  const handleSubmitJob = useCallback(() => {
    void launchJob('submit');
  }, [launchJob]);

  const handleRunJob = useCallback(() => {
    void launchJob('run');
  }, [launchJob]);

  useRegisterPlayChrome(
    {
      run: platform
        ? {
            label: 'Run',
            busyLabel: 'Running…',
            onClick: () => { void handleRunJob(); },
            busy: submitting,
          }
        : null,
      primary: platform
        ? {
            label: 'Submit',
            busyLabel: 'Submitting…',
            onClick: () => { void handleSubmitJob(); },
            busy: submitting,
          }
        : null,
      submissions: platform
        ? {
            label: 'Submissions',
            onClick: () => {
              setShowSubmissions((v) => {
                const next = !v;
                if (next) setSubmissionsPage(0);
                return next;
              });
              setShowJobPanel(false);
              if (session?.id) {
                void fetchSparkSubmissions(session.id)
                  .then((subs) => {
                    setSubmissions(subs);
                    setSubmissionsPage(0);
                  })
                  .catch(() => {});
              }
            },
          }
        : null,
      status: latestJob ? (
        <ChromeIconButton
          title={`Job ${latestJob.status} — toggle output`}
          onClick={() => {
            setShowJobPanel((v) => !v);
            setShowSubmissions(false);
          }}
          className={statusClass(latestJob.status)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden focusable="false">
            <path
              d="M4 6h16M4 12h10M4 18h7"
              fill="none"
              stroke="#e8eaf4"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </ChromeIconButton>
      ) : null,
    },
    [platform, submitting, latestJob, handleSubmitJob, handleRunJob, session?.id],
  );

  if (!session || !challenge || !platform) return null;

  return (
    <div
      ref={shellRef}
      className={`workspace sandbox-workspace spark-platform-workspace${briefCollapsed ? ' spark-brief-collapsed' : ''}`}
      style={
        briefCollapsed
          ? { gridTemplateColumns: 'minmax(0, 1fr)' }
          : { gridTemplateColumns: `${briefWidth}px 6px minmax(0, 1fr)` }
      }
    >
      {!briefCollapsed && (
        <div className="col spark-brief-col">
          <div className="panel sandbox-brief-panel--solo spark-brief-panel--bare" style={{ flex: 1 }}>
            <button
              type="button"
              className="spark-brief-collapse-btn"
              title="Collapse problem panel"
              aria-label="Collapse problem panel"
              onClick={() => setBriefCollapsed(true)}
            >
              ⟨
            </button>
            <div className="panel-body">
              <ProblemStatement challenge={challenge} />
              <div className="spark-platform-meta">
                <h4>Project workspace</h4>
                <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>
                  Open files from the explorer. Cluster paths and schema live in <code>README.md</code>.
                </p>
                <details className="spark-grade-brief">
                  <summary>Grading checklist</summary>
                  <ul className="spark-grade-list" style={{ marginTop: 8 }}>
                    {platform.gradeChecks.map((item) => (
                      <li key={item} style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item}</li>
                    ))}
                  </ul>
                </details>
              </div>
            </div>
          </div>
        </div>
      )}

      {!briefCollapsed && (
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
            const shellWidth = shellRef.current?.getBoundingClientRect().width || window.innerWidth;
            setBriefWidth(defaultBriefWidth(shellWidth));
          }}
        />
      )}

      {briefCollapsed && (
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

      <div className="col col-main">
        <div className="panel spark-ide-panel" style={{ flex: 1 }}>
          <div
            ref={ideBodyRef}
            className={`panel-body flush spark-ide-body${
              (showJobPanel && latestJob) || showSubmissions ? ' spark-ide-body--job-open' : ''
            }`}
            style={
              (showJobPanel && latestJob) || showSubmissions
                ? ({ ['--spark-job-drawer-h' as string]: `${jobDrawerHeight}px` } as React.CSSProperties)
                : undefined
            }
          >            {workspaceLoadError ? (
              <div className="alert" style={{ margin: 16 }}>
                {workspaceLoadError}
              </div>
            ) : Object.keys(files).length === 0 ? (
              <div className="muted" style={{ margin: 16, fontSize: 13 }}>
                Loading workspace…
              </div>
            ) : (
              <SparkProjectEditor
                key={`${session?.id || challenge.id}-ready`}
                files={files}
                onChangeFiles={setFiles}
                entryFile={platform.starterFileName || 'src/main.py'}
                onContentChange={trackContentChange}
                onFileCreated={notifyCreated}
                onFileDeleted={notifyDeleted}
                onFileRenamed={notifyRenamed}
              />
            )}
            {!workspaceLoadError && (syncStatus !== 'offline' || syncError) && (
              <div className="spark-sync-status" title={syncError || undefined}>
                {syncStatus === 'saving' && 'Saving…'}
                {syncStatus === 'saved' && 'Saved'}
                {syncStatus === 'error' && (syncError || 'Save failed')}
                {syncStatus === 'idle' && 'Ready'}
              </div>
            )}
            {showJobPanel && latestJob && (
              <div className="spark-job-drawer" style={{ height: jobDrawerHeight }}>
                <div
                  className="spark-job-drawer-resize"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize job logs"
                  title="Drag to resize"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    resizingDrawer.current = true;
                    document.body.style.cursor = 'row-resize';
                    document.body.style.userSelect = 'none';
                  }}
                  onDoubleClick={() => setJobDrawerHeight(JOB_DRAWER_DEFAULT)}
                />
                <div className="spark-job-drawer-header">
                  <strong>{latestJob.name}</strong>
                  <span className={`spark-job-status ${statusClass(latestJob.status)}`}>
                    {latestJob.status}
                  </span>
                  {gradeBadge(latestJob) && (
                    <span
                      className={`spark-grade-badge ${
                        latestJob.gradeStatus === 'passed'
                          ? 'spark-grade-badge--ok'
                          : latestJob.gradeStatus === 'failed'
                            ? 'spark-grade-badge--fail'
                            : 'spark-grade-badge--run'
                      }`}
                    >
                      {gradeBadge(latestJob)}
                    </span>
                  )}
                  <button type="button" className="ghost sm" onClick={() => setShowJobPanel(false)}>
                    ×
                  </button>
                </div>
                {latestJob.error && (
                  <div className="alert spark-job-error">{latestJob.error}</div>
                )}
                {latestJob.gradeResult?.summary && (
                  <div className="spark-grade-summary">{latestJob.gradeResult.summary}</div>
                )}
                <SparkDebugMeta job={latestJob} />
                <pre className="spark-job-logs">{(latestJob.logs || []).join('\n')}</pre>
              </div>
            )}
            {showSubmissions && (
              <div className="spark-job-drawer spark-submissions-drawer" style={{ height: jobDrawerHeight }}>
                <div
                  className="spark-job-drawer-resize"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize submissions"
                  title="Drag to resize"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    resizingDrawer.current = true;
                    document.body.style.cursor = 'row-resize';
                    document.body.style.userSelect = 'none';
                  }}
                  onDoubleClick={() => setJobDrawerHeight(JOB_DRAWER_DEFAULT)}
                />
                <div className="spark-job-drawer-header">
                  <strong>Submissions</strong>
                  <span className="muted" style={{ fontSize: 11 }}>{submissions.length}</span>
                  <button type="button" className="ghost sm" onClick={() => setShowSubmissions(false)}>
                    ×
                  </button>
                </div>
                <div className="spark-submissions-list">
                  {submissions.length === 0 ? (
                    <div className="muted" style={{ padding: 16, fontSize: 13 }}>
                      No submissions yet. Submit runs the pipeline and evaluates against eval/solution.json.
                    </div>
                  ) : (
                    <>
                      {pagedSubmissions.map((sub) => (
                        <div key={sub.id} className="spark-submission-card">
                          <button
                            type="button"
                            className="spark-submission-row"
                            onClick={() => {
                              upsertJob(sub);
                              setShowSubmissions(false);
                              setShowJobPanel(true);
                            }}
                          >
                            <span className="spark-submission-name">{sub.name}</span>
                            <span className={`spark-job-status ${statusClass(sub.status)}`}>{sub.status}</span>
                            {gradeBadge(sub) && (
                              <span
                                className={`spark-grade-badge ${
                                  sub.gradeStatus === 'passed'
                                    ? 'spark-grade-badge--ok'
                                    : sub.gradeStatus === 'failed'
                                      ? 'spark-grade-badge--fail'
                                      : 'spark-grade-badge--run'
                                }`}
                              >
                                {gradeBadge(sub)}
                              </span>
                            )}
                            <span className="spark-submission-time">
                              {sub.submittedAt ? new Date(sub.submittedAt).toLocaleString() : ''}
                            </span>
                          </button>
                          <SparkDebugMeta job={sub} />
                        </div>
                      ))}
                      {submissionsPageCount > 1 && (
                        <div className="spark-submissions-pager">
                          <button
                            type="button"
                            className="ghost sm"
                            disabled={safeSubmissionsPage <= 0}
                            onClick={() => setSubmissionsPage((p) => Math.max(0, p - 1))}
                          >
                            ← Prev
                          </button>
                          <span className="spark-submissions-pager-label">
                            {safeSubmissionsPage + 1} / {submissionsPageCount}
                          </span>
                          <button
                            type="button"
                            className="ghost sm"
                            disabled={safeSubmissionsPage >= submissionsPageCount - 1}
                            onClick={() =>
                              setSubmissionsPage((p) => Math.min(submissionsPageCount - 1, p + 1))
                            }
                          >
                            Next →
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function isSparkPlatformChallenge(
  challenge: ChallengePublic | ChallengeFull | null | undefined,
): boolean {
  return (challenge?.sandboxType || '') === 'spark-platform';
}
