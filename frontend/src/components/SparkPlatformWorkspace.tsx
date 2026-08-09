import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ProblemStatement, { type ProblemStatementTab } from './ProblemStatement';
import SparkProjectEditor from './SparkProjectEditor';
import {
  type SparkProjectFiles,
} from '../fixtures/dailyProductSalesL1';
import { IconPlay, IconSubmit } from './ChromeIcons';
import { useWorkspaceSync } from '../hooks/useWorkspaceSync';
import {
  fetchSparkJob,
  fetchSparkJobs,
  fetchSparkSubmissions,
  fetchWorkspace,
  startSparkJob,
} from '../services/workspaceApi';
import { fetchChallengeSolution } from '../services/challengeApi';
import type {
  ActiveSession,
  ChallengeFull,
  ChallengePublic,
  SparkJobRecord,
  SparkJobStatus,
} from '../types/domain';

const BRIEF_MIN = 280;
const BRIEF_RATIO = 0.38;
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

function shortAppId(id: string | null | undefined): string {
  const s = String(id || '').trim();
  if (!s) return 'pending…';
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}…${s.slice(-4)}`;
}

function SparkDebugMeta({ job }: { job: SparkJobRecord }): JSX.Element | null {
  if (!job.applicationId && !job.historyUrl) return null;
  return (
    <div className="spark-job-debug" onClick={(e) => e.stopPropagation()}>
      <div className="spark-job-debug-row">
        <span className="spark-job-debug-label">Application ID</span>
        <code className="spark-job-debug-value" title={job.applicationId || undefined}>
          {shortAppId(job.applicationId)}
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
            Open History ↗
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
  const [briefTab, setBriefTab] = useState<ProblemStatementTab>('description');
  const [solutionFiles, setSolutionFiles] = useState<Record<string, string> | null>(null);
  const [solutionEntrypoint, setSolutionEntrypoint] = useState<string | null>(null);
  const [solutionLoading, setSolutionLoading] = useState(false);
  const [solutionError, setSolutionError] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<SparkJobRecord[]>([]);
  const [submissionsPage, setSubmissionsPage] = useState(0);
  const [resultsOpen, setResultsOpen] = useState(false);
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
      setBriefTab('description');
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

  const solutionFetchedFor = useRef<string | null>(null);

  useEffect(() => {
    solutionFetchedFor.current = null;
    setSolutionFiles(null);
    setSolutionEntrypoint(null);
    setSolutionError(null);
    setSolutionLoading(false);
  }, [challenge?.id]);

  useEffect(() => {
    if (briefTab !== 'solution' || !challenge?.id) return;
    if (solutionFetchedFor.current === challenge.id) return;

    let cancelled = false;
    setSolutionLoading(true);
    setSolutionError(null);
    (async () => {
      try {
        const payload = await fetchChallengeSolution(challenge.id);
        if (cancelled) return;
        solutionFetchedFor.current = challenge.id;
        setSolutionFiles(payload.files);
        setSolutionEntrypoint(payload.entrypoint || null);
      } catch (e) {
        if (cancelled) return;
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        setSolutionError(
          err?.response?.data?.error
            || err.message
            || 'Failed to load solution from MinIO',
        );
      } finally {
        if (!cancelled) setSolutionLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [briefTab, challenge?.id]);

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

  const refreshSubmissions = useCallback(() => {
    if (!session?.id) return;
    void fetchSparkSubmissions(session.id)
      .then((subs) => {
        setSubmissions(subs);
        setSubmissionsPage(0);
      })
      .catch(() => {});
  }, [session?.id]);

  const launchJob = useCallback(async (mode: 'run' | 'submit') => {
    if (submitting || !platform || !session?.id) return;
    setSubmitting(true);
    setResultsOpen(true);
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
      const cases =
        mode === 'run'
          ? (platform.runCases || [])
          : (platform.submitCases || []);
      const useTestcases = Boolean(platform.testcasesPrefix && cases.length);
      const job = await startSparkJob(session.id, {
        mode,
        // Legacy path for challenges without testcases/
        inputPath: useTestcases
          ? undefined
          : (mode === 'run'
            ? (platform.runInputPath || platform.inputPath)
            : platform.inputPath),
        businessDate: platform.businessDate,
        evalSolutionPath: useTestcases
          ? platform.testcasesPrefix
          : (mode === 'run'
            ? (platform.runEvalPath || platform.evalSolutionPath)
            : platform.evalSolutionPath),
        testcasesPrefix: useTestcases ? platform.testcasesPrefix : undefined,
        cases: useTestcases ? cases : undefined,
        gradeKeys: platform.gradeKeys,
        outputFormat: platform.outputFormat,
        productsPath: platform.productsPath,
        dualInput: platform.dualInput,
        limits: platform.limits,
      });
      upsertJob(job);
      if (job.mode === 'submit') {
        setSubmissions((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
        setBriefTab('submissions');
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

  if (!session || !challenge || !platform) return null;

  const gradeChecks = platform.gradeChecks || [];

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
            <div className="spark-brief-tabs" role="tablist" aria-label="Problem sections">
              {([
                ['description', 'Description'],
                ['hints', 'Hints'],
                ['spec', 'Spec'],
                ['theory', 'Theory'],
                ['solution', 'Solution'],
                ['submissions', 'Submissions'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={briefTab === id}
                  className={`spark-brief-tab${briefTab === id ? ' active' : ''}`}
                  onClick={() => {
                    setBriefTab(id);
                    if (id === 'submissions') refreshSubmissions();
                  }}
                >
                  {label}
                  {id === 'submissions' && submissions.length > 0 && (
                    <span className="spark-brief-tab-count">{submissions.length}</span>
                  )}
                </button>
              ))}
              <button
                type="button"
                className="spark-brief-collapse-btn"
                title="Collapse problem panel"
                aria-label="Collapse problem panel"
                onClick={() => setBriefCollapsed(true)}
              >
                ⟨
              </button>
            </div>
            <div className="panel-body spark-brief-body">
              <ProblemStatement
                challenge={challenge}
                tab={briefTab}
                solutionFiles={solutionFiles}
                solutionEntrypoint={solutionEntrypoint}
                solutionLoading={solutionLoading}
                solutionError={solutionError}
                submissionsSlot={
                  briefTab === 'submissions' ? (
                    <div className="spark-submissions-list spark-submissions-list--brief">
                      {submissions.length === 0 ? (
                        <p className="dim" style={{ fontSize: 13, margin: 0 }}>
                          No submissions yet. Submit runs the pipeline and grades against the expected outputs.
                        </p>
                      ) : (
                        <>
                          {pagedSubmissions.map((sub) => (
                            <div key={sub.id} className="spark-submission-card">
                              <button
                                type="button"
                                className="spark-submission-row"
                                onClick={() => {
                                  upsertJob(sub);
                                  setResultsOpen(true);
                                }}
                              >
                                <span className="spark-submission-name">{sub.name}</span>
                                <span className={`spark-job-status ${statusClass(sub.status)}`}>
                                  {sub.status}
                                </span>
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
                                  {sub.historyUrl && (
                                    <a
                                      className="spark-job-debug-link"
                                      href={sub.historyUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={sub.historyUrl}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      History ↗
                                    </a>
                                  )}
                                </span>
                              </button>
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
                  ) : undefined
                }
                specExtra={
                  briefTab === 'spec' ? (
                    <div className="spark-platform-meta">
                      <section className="statement-section">
                        <h4>Identity</h4>
                        <div className="statement-table-wrap">
                          <table className="statement-table">
                            <thead>
                              <tr>
                                <th>Field</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className="statement-table-col">Number</td>
                                <td className="statement-table-type">
                                  <code>{challenge?.number != null ? challenge.number : '—'}</code>
                                </td>
                              </tr>
                              <tr>
                                <td className="statement-table-col">Slug</td>
                                <td className="statement-table-type">
                                  <code>{challenge?.id}</code>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </section>
                      <section className="statement-section">
                        <h4>Paths</h4>
                        <ul className="spark-grade-list">
                          {(platform.testcasesPrefix || platform.inputPath) && (
                            <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              Testcases: <code>{platform.testcasesPrefix || platform.inputPath}</code>
                            </li>
                          )}
                          {platform.dualInput && (
                            <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              Dual input: <code>INPUT_A_PATH</code> + <code>INPUT_B_PATH</code>
                            </li>
                          )}
                          {platform.runCases && platform.runCases.length > 0 && (
                            <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              Run cases: <code>{platform.runCases.join(', ')}</code>
                            </li>
                          )}
                          {platform.submitCases && platform.submitCases.length > 0 && (
                            <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              Submit cases: <code>{platform.submitCases.join(', ')}</code>
                            </li>
                          )}
                          {platform.outputFormat && (
                            <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              Output format: <code>{platform.outputFormat}</code>
                            </li>
                          )}
                          {platform.gradeKeys && platform.gradeKeys.length > 0 && (
                            <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              Grade keys: <code>{platform.gradeKeys.join(', ')}</code>
                            </li>
                          )}
                          {platform.businessDate && (
                            <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              Business date: <code>{platform.businessDate}</code>
                            </li>
                          )}
                          {platform.productsPath && (
                            <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              Products: <code>{platform.productsPath}</code>
                            </li>
                          )}
                        </ul>
                      </section>
                      {platform.limits && (
                        <section className="statement-section">
                          <h4>Job resources</h4>
                          <p className="dim" style={{ fontSize: 12, margin: '4px 0 8px' }}>
                            Applied to every Run and Submit Spark job for this challenge.
                          </p>
                          <div className="statement-table-wrap">
                            <table className="statement-table">
                              <thead>
                                <tr>
                                  <th>Resource</th>
                                  <th>Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className="statement-table-col">Driver cores</td>
                                  <td className="statement-table-type">
                                    {platform.limits.driver ?? 1}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="statement-table-col">Driver memory</td>
                                  <td className="statement-table-type">
                                    {platform.limits.driverMemory || '1g'}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="statement-table-col">Executor instances</td>
                                  <td className="statement-table-type">
                                    {platform.limits.executors}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="statement-table-col">Executor cores</td>
                                  <td className="statement-table-type">
                                    {platform.limits.executorCores}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="statement-table-col">Executor memory</td>
                                  <td className="statement-table-type">
                                    {platform.limits.executorMemory}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </section>
                      )}
                      {gradeChecks.length > 0 && (
                        <section className="statement-section">
                          <h4>Grading checklist</h4>
                          <ul className="spark-grade-list" style={{ marginTop: 8 }}>
                            {gradeChecks.map((item) => (
                              <li key={item} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {item}
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                    </div>
                  ) : undefined
                }
              />
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
          <div className="spark-ide-actionbar">
            <div className="spark-ide-actionbar-left" />
            <div className="spark-ide-actionbar-right">
              {!workspaceLoadError && (syncStatus !== 'offline' || syncError) && (
                <span className="spark-sync-inline" title={syncError || undefined}>
                  {syncStatus === 'saving' && 'Saving…'}
                  {syncStatus === 'saved' && 'Saved'}
                  {syncStatus === 'error' && (syncError || 'Save failed')}
                  {syncStatus === 'idle' && 'Ready'}
                </span>
              )}
              <button
                type="button"
                className="spark-ide-btn spark-ide-btn--run"
                onClick={handleRunJob}
                disabled={submitting}
                title="Run"
              >
                <IconPlay color="currentColor" />
                <span>{submitting ? 'Running…' : 'Run'}</span>
              </button>
              <button
                type="button"
                className="spark-ide-btn spark-ide-btn--submit"
                onClick={handleSubmitJob}
                disabled={submitting}
                title="Submit"
              >
                <IconSubmit color="#04120c" />
                <span>{submitting ? 'Submitting…' : 'Submit'}</span>
              </button>
            </div>
          </div>
          <div
            ref={ideBodyRef}
            className={`panel-body flush spark-ide-body${resultsOpen ? ' spark-ide-body--job-open' : ''}`}
            style={
              resultsOpen
                ? ({ ['--spark-job-drawer-h' as string]: `${jobDrawerHeight}px` } as React.CSSProperties)
                : undefined
            }
          >
            {workspaceLoadError ? (
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

            {!resultsOpen && (
              <button
                type="button"
                className="spark-results-reopen"
                onClick={() => setResultsOpen(true)}
                title="Show results"
              >
                <span>Result</span>
                {latestJob && (
                  <span className={`spark-job-status ${statusClass(latestJob.status)}`}>
                    {latestJob.status}
                  </span>
                )}
                <span className="spark-results-reopen-chevron" aria-hidden>
                  ⌃
                </span>
              </button>
            )}

            {resultsOpen && (
              <div className="spark-job-drawer spark-results-drawer" style={{ height: jobDrawerHeight }}>
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
                  onDoubleClick={() => setJobDrawerHeight(JOB_DRAWER_DEFAULT)}
                />
                <div className="spark-job-drawer-header spark-results-tabs-header">
                  <div className="spark-results-tabs" aria-label="Results">
                    <span className="spark-results-tab active">Result</span>
                  </div>
                  <div className="spark-results-header-right">
                    {latestJob && (
                      <div className="spark-results-meta">
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
                      </div>
                    )}
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

                {!latestJob ? (
                  <div className="muted spark-results-empty">
                    Run or Submit to see job output and grading here.
                  </div>
                ) : (
                  <>
                    {latestJob.error && (
                      <div className="alert spark-job-error">{latestJob.error}</div>
                    )}
                    {latestJob.gradeResult?.summary && (
                      <div className="spark-grade-summary">{latestJob.gradeResult.summary}</div>
                    )}
                    <SparkDebugMeta job={latestJob} />
                    <pre className="spark-job-logs">{(latestJob.logs || []).join('\n')}</pre>
                  </>
                )}
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
