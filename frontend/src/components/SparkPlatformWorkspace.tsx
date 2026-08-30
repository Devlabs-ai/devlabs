import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ProblemStatement, { type ProblemStatementTab } from './ProblemStatement';
import SparkProjectEditor from './SparkProjectEditor';
import {
  type SparkProjectFiles,
} from '../fixtures/dailyProductSalesL1';
import { buildSparkPlaygroundPlatform } from '../fixtures/sparkPlaygroundStarter';
import { SPARK_PLAYGROUND_CHALLENGE_ID } from '../constants/playgroundDatasets';
import {
  PLAYGROUND_DRIVER_CORES,
  PLAYGROUND_EXECUTOR_CORES,
  PLAYGROUND_EXECUTOR_COUNTS,
  PLAYGROUND_MEMORY_OPTIONS,
  PLAYGROUND_SHUFFLE_PARTITIONS,
  PLAYGROUND_TRAIL_PRESETS,
  formatTrailSummary,
  matchTrailPresetId,
  normalizeTrailLimits,
  readStoredTrailLimits,
  storeTrailLimits,
  type PlaygroundTrailLimits,
} from '../constants/playgroundTrail';
import {
  defaultsFromKnobDefs,
  formatKnobSummary,
  knobValuesToSparkConf,
  normalizeKnobValues,
  readStoredKnobValues,
  storeKnobValues,
  type SparkKnobDef,
  type SparkKnobValues,
} from '../constants/sparkKnobs';
import BriefAdminEditor, { isEditableBriefTab } from './BriefAdminEditor';
import { useAppState } from '../context/AppStateContext';
import { isAdminUser, getCurrentUser } from '../services/authApi';
import { IconPen, IconPlay, IconStop, IconSubmit } from './ChromeIcons';
import { useWorkspaceSync } from '../hooks/useWorkspaceSync';
import {
  fetchSparkJob,
  fetchSparkJobFiles,
  fetchSparkJobs,
  fetchSparkSubmissions,
  fetchWorkspace,
  killSparkJob,
  putWorkspaceFile,
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
const EMPTY_KNOB_DEFS: SparkKnobDef[] = [];

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

function paceBadge(job: SparkJobRecord): { label: string; tone: string } | null {
  if (job.mode !== 'submit' || job.gradeStatus !== 'passed') return null;
  const pace = job.gradeResult?.score?.pace;
  if (!pace?.label) return null;
  return { label: pace.label, tone: pace.tone || 'steady' };
}

function jobExecMs(job: SparkJobRecord): number | null {
  const n = job.executionDurationMs ?? job.runMetrics?.sparkJobsDurationMs ?? null;
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

function displayGradeSummary(summary: string | undefined): string {
  const s = String(summary || '').trim();
  if (!s) return '';
  return s
    .replace(/^Passed — [\d.]+ \(exec [^,]+, target [^)]+\)$/, 'Passed')
    .replace(/^Passed — waiting for History execution time$/, 'Passed')
    .replace(/ · [\d.]+$/, '');
}

function submissionTabFileName(name: string, entrypoint: string): string {
  const base = String(name || 'submission')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'submission';
  const ext = (entrypoint.split('.').pop() || 'py').toLowerCase();
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

function formatJobLogs(logs: string[] | undefined): string {
  return (logs || [])
    .map((line) => String(line).replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
    .join('\n');
}

function shortAppId(id: string | null | undefined): string {
  const s = String(id || '').trim();
  if (!s) return 'pending…';
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}…${s.slice(-4)}`;
}

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function trailSummaryFromLogs(logs: string[] | undefined): string | null {
  if (!logs?.length) return null;
  const line = logs.find(
    (l) => l.startsWith('Trail resources:') || l.startsWith('Resources:'),
  );
  if (!line) return null;
  return line.replace(/^(Trail resources|Resources):\s*/, '').trim() || null;
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
  challenge: challengeProp,
  session,
}: SparkPlatformWorkspaceProps): JSX.Element | null {
  const { currentUser } = useAppState();
  const isAdmin = isAdminUser(currentUser) || isAdminUser(getCurrentUser());
  const [authored, setAuthored] = useState<ChallengeFull | null>(null);
  const [adminEditing, setAdminEditing] = useState(false);
  const [adminWantEdit, setAdminWantEdit] = useState(false);
  const challenge = (
    authored && authored.id === challengeProp?.id ? authored : challengeProp
  );
  const isPlayground = challenge?.id === SPARK_PLAYGROUND_CHALLENGE_ID;

  useEffect(() => {
    setAuthored(null);
    setAdminEditing(false);
    setAdminWantEdit(false);
  }, [challengeProp?.id]);
  const basePlatform = isSparkChallenge(challenge) ? challenge.sparkPlatform ?? null : null;
  const platform = useMemo(() => {
    if (!basePlatform) return null;
    if (!isPlayground) return basePlatform;
    return buildSparkPlaygroundPlatform();
  }, [basePlatform, isPlayground]);
  const notesStorageKey = session?.id
    ? `devlabs.sparkPlayground.notes.${session.id}`
    : null;
  const readNotes = useCallback((): string => {
    if (!session?.id) return '';
    try {
      return sessionStorage.getItem(`devlabs.sparkPlayground.notes.${session.id}`) || '';
    } catch {
      return '';
    }
  }, [session?.id]);
  const [notesDraft, setNotesDraft] = useState(readNotes);
  const [notesSaved, setNotesSaved] = useState(readNotes);
  const [notesSaveFlash, setNotesSaveFlash] = useState(false);
  const notesDirty = notesDraft !== notesSaved;

  const [trailDraft, setTrailDraft] = useState<PlaygroundTrailLimits>(readStoredTrailLimits);
  const [trailSaved, setTrailSaved] = useState<PlaygroundTrailLimits>(readStoredTrailLimits);
  const [trailSaveFlash, setTrailSaveFlash] = useState(false);
  const trailPresetId = matchTrailPresetId(trailDraft);
  const trailDirty = formatTrailSummary(trailDraft) !== formatTrailSummary(trailSaved);

  const patchTrailDraft = useCallback((next: Partial<PlaygroundTrailLimits>) => {
    setTrailDraft((prev) => normalizeTrailLimits({ ...prev, ...next }));
  }, []);

  const saveTrailResources = useCallback(() => {
    const normalized = normalizeTrailLimits(trailDraft);
    setTrailDraft(normalized);
    setTrailSaved(normalized);
    storeTrailLimits(normalized);
    setTrailSaveFlash(true);
  }, [trailDraft]);

  const knobDefs = platform?.knobs?.length ? platform.knobs : EMPTY_KNOB_DEFS;
  const hasKnobs = knobDefs.length > 0;
  const knobDefaults = useMemo(() => defaultsFromKnobDefs(knobDefs), [knobDefs]);
  const [knobDraft, setKnobDraft] = useState<SparkKnobValues>(knobDefaults);
  const [knobSaved, setKnobSaved] = useState<SparkKnobValues>(knobDefaults);
  const [knobSaveFlash, setKnobSaveFlash] = useState(false);
  const knobDirty = formatKnobSummary(knobDraft, knobDefs) !== formatKnobSummary(knobSaved, knobDefs);

  useEffect(() => {
    if (!challenge?.id || isPlayground) return;
    const stored = readStoredKnobValues(challenge.id, knobDefs);
    setKnobDraft(stored);
    setKnobSaved(stored);
  }, [challenge?.id, isPlayground, knobDefs]);

  useEffect(() => {
    if (!knobSaveFlash) return;
    const t = window.setTimeout(() => setKnobSaveFlash(false), 1600);
    return () => window.clearTimeout(t);
  }, [knobSaveFlash]);

  const saveLabKnobs = useCallback(() => {
    if (!challenge?.id) return;
    const normalized = normalizeKnobValues(knobDraft, knobDefs);
    setKnobDraft(normalized);
    setKnobSaved(normalized);
    storeKnobValues(challenge.id, normalized);
    setKnobSaveFlash(true);
  }, [challenge?.id, knobDraft, knobDefs]);

  const savePlaygroundNotes = useCallback(() => {
    setNotesSaved(notesDraft);
    if (notesStorageKey) {
      try {
        sessionStorage.setItem(notesStorageKey, notesDraft);
      } catch {
        /* ignore */
      }
    }
    setNotesSaveFlash(true);
  }, [notesDraft, notesStorageKey]);

  useEffect(() => {
    if (!trailSaveFlash) return;
    const t = window.setTimeout(() => setTrailSaveFlash(false), 1600);
    return () => window.clearTimeout(t);
  }, [trailSaveFlash]);

  useEffect(() => {
    if (!notesSaveFlash) return;
    const t = window.setTimeout(() => setNotesSaveFlash(false), 1600);
    return () => window.clearTimeout(t);
  }, [notesSaveFlash]);

  useEffect(() => {
    const stored = readNotes();
    setNotesDraft(stored);
    setNotesSaved(stored);
  }, [readNotes]);

  const [files, setFiles] = useState<SparkProjectFiles>({});
  const [jobs, setJobs] = useState<SparkJobRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [killing, setKilling] = useState(false);
  const [briefTab, setBriefTab] = useState<ProblemStatementTab>(
    challenge?.id === SPARK_PLAYGROUND_CHALLENGE_ID ? 'notes' : 'description',
  );
  const [solutionFiles, setSolutionFiles] = useState<Record<string, string> | null>(null);
  const [solutionEntrypoint, setSolutionEntrypoint] = useState<string | null>(null);
  const [solutionLoading, setSolutionLoading] = useState(false);
  const [solutionError, setSolutionError] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<SparkJobRecord[]>([]);
  const [submissionsPage, setSubmissionsPage] = useState(0);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [submissionPreview, setSubmissionPreview] = useState<{
    key: string;
    fileName: string;
    content: string;
  } | null>(null);
  const [runEntrypoint, setRunEntrypoint] = useState('src/main.py');
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

  useEffect(() => {
    setRunEntrypoint(platform?.starterFileName || 'src/main.py');
  }, [challenge?.id, platform?.starterFileName]);

  const pythonVersions = useMemo(() => {
    const fromWorkspace = Object.keys(files)
      .filter((p) => p.endsWith('.py') && !p.includes('__pycache__'))
      .sort((a, b) => a.localeCompare(b));
    const ghost = submissionPreview
      ? `.submissions/${submissionPreview.fileName}`
      : null;
    const opts = fromWorkspace.map((path) => ({ path, label: path }));
    if (ghost && !fromWorkspace.includes(ghost)) {
      opts.push({ path: ghost, label: `${submissionPreview?.fileName} (submission)` });
    }
    return opts;
  }, [files, submissionPreview]);

  const latestJob = jobs[0] || null;
  const viewingJob = (
    selectedJobId
      ? jobs.find((j) => j.id === selectedJobId)
        || submissions.find((j) => j.id === selectedJobId)
        || latestJob
      : latestJob
  );

  const viewingSummary = displayGradeSummary(viewingJob?.gradeResult?.summary);

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

  const openJobSnapshot = useCallback(async (job: SparkJobRecord) => {
    if (!session?.id || String(job.id).startsWith('pending-')) return;
    try {
      const snap = await fetchSparkJobFiles(session.id, job.id);
      const entry = snap.entrypoint || 'src/main.py';
      const firstPy = Object.entries(snap.files).find(([p]) => p.endsWith('.py'));
      const content = snap.files[entry] || snap.files['src/main.py'] || firstPy?.[1] || '';
      if (!content) return;
      setSubmissionPreview({
        key: snap.jobId,
        fileName: submissionTabFileName(snap.name || job.name, entry),
        content,
      });
      setRunEntrypoint(`.submissions/${submissionTabFileName(snap.name || job.name, entry)}`);
    } catch {
      /* snapshot missing */
    }
  }, [session?.id]);

  const launchJob = useCallback(async (mode: 'run' | 'submit') => {
    if (submitting || !platform || !session?.id) return;
    setSubmitting(true);
    setResultsOpen(true);
    const starter = platform.starterFileName || 'src/main.py';
    let entrypoint = runEntrypoint || starter;
    try {
      if (entrypoint.startsWith('.submissions/') && submissionPreview) {
        const dest = `versions/${submissionPreview.fileName}`;
        setFiles((prev) => ({ ...prev, [dest]: submissionPreview.content }));
        notifyCreated(dest, submissionPreview.content);
        try {
          await putWorkspaceFile(session.id, dest, submissionPreview.content);
        } catch {
          /* flush may still pick it up */
        }
        entrypoint = dest;
        setRunEntrypoint(dest);
      }
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
        `Entrypoint ${entrypoint}`,
        isPlayground
          ? `Resources: ${formatTrailSummary(trailSaved)}`
          : 'Snapshotting project and submitting SparkApplication…',
        'Snapshotting project and submitting SparkApplication…',
        ...(isPlayground
          ? ['DUMP_PATH is injected for stable experiment dumps (see job env / starter).']
          : []),
      ],
    };
    setJobs((prev) => [pending, ...prev]);
    setSelectedJobId(pendingId);

    try {
      const cases =
        mode === 'run'
          ? (platform.runCases || [])
          : (platform.submitCases || []);
      const useTestcases = Boolean(platform.testcasesPrefix && cases.length);
      const namedCatalogue =
        Boolean(platform.txnInputPath && platform.rateInputPath)
        || Boolean(platform.eventsInputPath && platform.catalogInputPath);
      const resolvedInputPath = useTestcases
        ? undefined
        : isPlayground
          ? undefined
          : namedCatalogue
            ? undefined
            : (mode === 'run'
              ? (platform.runInputPath || platform.inputPath)
              : platform.inputPath);
      const job = await startSparkJob(session.id, {
        mode,
        // Legacy path for challenges without testcases/; playground omits INPUT_PATH.
        inputPath: resolvedInputPath || undefined,
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
        txnInputPath: mode === 'run'
          ? (platform.runTxnInputPath || platform.txnInputPath)
          : platform.txnInputPath,
        rateInputPath: mode === 'run'
          ? (platform.runRateInputPath || platform.rateInputPath)
          : platform.rateInputPath,
        eventsInputPath: mode === 'run'
          ? (platform.runEventsInputPath || platform.eventsInputPath)
          : platform.eventsInputPath,
        catalogInputPath: mode === 'run'
          ? (platform.runCatalogInputPath || platform.catalogInputPath)
          : platform.catalogInputPath,
        gradeScript: platform.gradeScript,
        dualInput: platform.dualInput,
        limits: isPlayground ? trailSaved : platform.limits,
        sparkKnobs: isPlayground ? undefined : knobValuesToSparkConf(knobSaved, knobDefs),
        entrypoint,
      });
      upsertJob(job);
      setSelectedJobId(job.id);
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
  }, [submitting, platform, session?.id, flush, upsertJob, pollJob, isPlayground, trailSaved, knobSaved, knobDefs, runEntrypoint, submissionPreview, notifyCreated]);

  const handleSubmitJob = useCallback(() => {
    void launchJob('submit');
  }, [launchJob]);

  const handleRunJob = useCallback(() => {
    void launchJob('run');
  }, [launchJob]);

  const liveJob = useMemo(
    () => jobs.find((j) => !j.id.startsWith('pending-') && !isTerminalStatus(j.status)) || null,
    [jobs],
  );
  const jobInFlight = submitting || Boolean(liveJob) || jobs.some((j) => j.id.startsWith('pending-'));

  const handleKillJob = useCallback(async () => {
    if (!session?.id || !liveJob || killing) return;
    setKilling(true);
    try {
      const job = await killSparkJob(session.id, liveJob.id);
      stopPolling(liveJob.id);
      upsertJob(job);
      if (job.mode === 'submit') {
        setSubmissions((prev) => {
          const rest = prev.filter((j) => j.id !== job.id);
          return [job, ...rest].sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
        });
      }
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      upsertJob({
        ...liveJob,
        status: 'failed',
        finishedAt: Date.now(),
        error: err?.response?.data?.error || err.message || 'Failed to kill Spark job',
      });
      stopPolling(liveJob.id);
    } finally {
      setKilling(false);
    }
  }, [session?.id, liveJob, killing, stopPolling, upsertJob]);

  const handleActivePathChange = useCallback((path: string) => {
    if (path.endsWith('.py')) setRunEntrypoint(path);
  }, []);

  const refreshPlaygroundRuns = useCallback(async () => {
    if (!session?.id || !isPlayground) return;
    try {
      const existing = await fetchSparkJobs(session.id);
      setJobs(existing);
    } catch {
      /* ignore */
    }
  }, [session?.id, isPlayground]);

  useEffect(() => {
    if (!isPlayground || briefTab !== 'runs') return;
    void refreshPlaygroundRuns();
  }, [isPlayground, briefTab, refreshPlaygroundRuns]);

  if (!session || !challenge || !platform) return null;

  const gradeChecks = platform.gradeChecks || [];
  const briefTabs: Array<[ProblemStatementTab, string]> = isPlayground
    ? [
        ['notes', 'Notes'],
        ['resources', 'Resources'],
        ['runs', 'Runs'],
      ]
    : [
        ['description', 'Description'],
        ['data', 'Data'],
        ['spec', 'Spec'],
        ...(hasKnobs ? [['knobs', 'Knobs'] as [ProblemStatementTab, string]] : []),
        ['solution', 'Solution'],
        ...(isAdmin ? [['moat', 'Moat'] as [ProblemStatementTab, string]] : []),
        ['submissions', 'Submissions'],
      ];

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
              {briefTabs.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={briefTab === id}
                  className={`spark-brief-tab${briefTab === id ? ' active' : ''}${id === 'moat' ? ' spark-brief-tab--setter' : ''}`}
                  onClick={() => {
                    setBriefTab(id);
                    setAdminWantEdit(false);
                    if (id === 'submissions') refreshSubmissions();
                  }}
                >
                  {label}
                  {id === 'submissions' && submissions.length > 0 && (
                    <span className="spark-brief-tab-count">{submissions.length}</span>
                  )}
                </button>
              ))}
              {isAdmin && !isPlayground && isEditableBriefTab(briefTab) && !adminEditing && (
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
              {isAdmin && !isPlayground && isEditableBriefTab(briefTab) && challenge && (
                <BriefAdminEditor
                  tab={briefTab}
                  challenge={challenge}
                  platform={platform}
                  solutionFiles={solutionFiles}
                  onEditingChange={(editing) => {
                    setAdminEditing(editing);
                    if (!editing) setAdminWantEdit(false);
                  }}
                  forceEdit={adminWantEdit}
                  onSaved={({ challenge: next, solutionFiles: files }) => {
                    setAuthored(next);
                    if (files) {
                      setSolutionFiles(files);
                      setSolutionError(null);
                    }
                  }}
                />
              )}
              {adminEditing ? null : isPlayground ? (
                briefTab === 'runs' ? (
                  <div className="play-playground-runs-pane">
                    <div className="play-playground-runs-head">
                      <p className="play-playground-trail-help">
                        Execution time is Spark jobs wall from History (first job → last job),
                        not image pull / driver·executor setup. Wall includes platform overhead.
                      </p>
                      <button
                        type="button"
                        className="ghost sm"
                        onClick={() => void refreshPlaygroundRuns()}
                      >
                        Refresh
                      </button>
                    </div>
                    {jobs.length === 0 ? (
                      <p className="dim" style={{ fontSize: 13, margin: 0 }}>
                        No runs yet. Hit Run to start a trail experiment.
                      </p>
                    ) : (
                      <ul className="play-playground-runs-list">
                        {jobs.map((job) => {
                          const trail = trailSummaryFromLogs(job.logs);
                          const execMs =
                            job.executionDurationMs
                            ?? job.runMetrics?.sparkJobsDurationMs
                            ?? null;
                          const wallMs =
                            job.wallDurationMs
                            ?? (job.finishedAt && job.submittedAt
                              ? job.finishedAt - job.submittedAt
                              : null);
                          return (
                            <li key={job.id}>
                              <button
                                type="button"
                                className="play-playground-run-card"
                                onClick={() => {
                                  upsertJob(job);
                                  setSelectedJobId(job.id);
                                  setResultsOpen(true);
                                  void openJobSnapshot(job);
                                }}
                              >
                                <div className="play-playground-run-top">
                                  <span className={`spark-job-status ${statusClass(job.status)}`}>
                                    {job.status}
                                  </span>
                                  <span className="play-playground-run-when">
                                    {job.submittedAt
                                      ? new Date(job.submittedAt).toLocaleString(undefined, {
                                          month: 'short',
                                          day: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })
                                      : '—'}
                                  </span>
                                </div>
                                <dl className="play-playground-run-metrics">
                                  <div>
                                    <dt>Execution</dt>
                                    <dd title="Spark jobs wall (History)">
                                      {formatDurationMs(execMs)}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>Wall</dt>
                                    <dd title="Submit → finished (includes setup)">
                                      {formatDurationMs(wallMs)}
                                    </dd>
                                  </div>
                                  <div className="play-playground-run-app">
                                    <dt>App</dt>
                                    <dd title="Full Spark application attempt">
                                      <span>
                                        {formatDurationMs(
                                          job.sparkAppDurationMs
                                            ?? job.runMetrics?.sparkAppDurationMs
                                            ?? null,
                                        )}
                                      </span>
                                      {job.historyUrl && (
                                        <a
                                          className="spark-job-debug-link play-playground-run-history"
                                          href={job.historyUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title={job.historyUrl}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          ↗
                                        </a>
                                      )}
                                    </dd>
                                  </div>
                                </dl>
                                {trail && (
                                  <p className="play-playground-run-trail">
                                    Resources · {trail}
                                  </p>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : briefTab === 'resources' ? (
                  <div className="play-playground-trail-pane">
                    <p className="play-playground-trail-help">
                      Set job resources for Runs (executors, memory, AQE, shuffle partitions).
                      Save to apply — unsaved edits are not used.
                    </p>
                    <div className="play-playground-trail-form">
                      <label className="play-playground-trail-field">
                        <span>Preset</span>
                        <select
                          value={trailPresetId}
                          onChange={(e) => {
                            const preset = PLAYGROUND_TRAIL_PRESETS.find(
                              (p) => p.id === e.target.value,
                            );
                            if (preset) setTrailDraft(normalizeTrailLimits(preset.limits));
                          }}
                        >
                          {PLAYGROUND_TRAIL_PRESETS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                          <option value="custom">Custom</option>
                        </select>
                      </label>
                      <label className="play-playground-trail-field">
                        <span>Executors</span>
                        <select
                          value={trailDraft.executors}
                          onChange={(e) =>
                            patchTrailDraft({ executors: Number(e.target.value) })
                          }
                        >
                          {PLAYGROUND_EXECUTOR_COUNTS.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <label className="play-playground-trail-field">
                        <span>Executor cores</span>
                        <select
                          value={trailDraft.executorCores}
                          onChange={(e) =>
                            patchTrailDraft({ executorCores: Number(e.target.value) })
                          }
                        >
                          {PLAYGROUND_EXECUTOR_CORES.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <label className="play-playground-trail-field">
                        <span>Executor memory</span>
                        <select
                          value={trailDraft.executorMemory}
                          onChange={(e) =>
                            patchTrailDraft({ executorMemory: e.target.value })
                          }
                        >
                          {PLAYGROUND_MEMORY_OPTIONS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </label>
                      <label className="play-playground-trail-field">
                        <span>Driver cores</span>
                        <select
                          value={trailDraft.driver}
                          onChange={(e) =>
                            patchTrailDraft({ driver: Number(e.target.value) })
                          }
                        >
                          {PLAYGROUND_DRIVER_CORES.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <label className="play-playground-trail-field">
                        <span>Driver memory</span>
                        <select
                          value={trailDraft.driverMemory}
                          onChange={(e) =>
                            patchTrailDraft({ driverMemory: e.target.value })
                          }
                        >
                          {PLAYGROUND_MEMORY_OPTIONS.map((m) => (
                            <option key={`drv-${m}`} value={m}>{m}</option>
                          ))}
                        </select>
                      </label>
                      <label className="play-playground-trail-field">
                        <span>AQE</span>
                        <select
                          value={trailDraft.aqe ? 'on' : 'off'}
                          onChange={(e) =>
                            patchTrailDraft({ aqe: e.target.value === 'on' })
                          }
                        >
                          <option value="on">On</option>
                          <option value="off">Off</option>
                        </select>
                      </label>
                      <label className="play-playground-trail-field">
                        <span>Shuffle partitions</span>
                        <select
                          value={trailDraft.shufflePartitions}
                          onChange={(e) =>
                            patchTrailDraft({
                              shufflePartitions: Number(e.target.value),
                            })
                          }
                        >
                          {PLAYGROUND_SHUFFLE_PARTITIONS.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="play-playground-trail-summary">
                      <div>
                        <span className="play-playground-trail-summary-label">Saved for Run</span>
                        <code>{formatTrailSummary(trailSaved)}</code>
                      </div>
                      {trailDirty && (
                        <div>
                          <span className="play-playground-trail-summary-label">Draft</span>
                          <code>{formatTrailSummary(trailDraft)}</code>
                        </div>
                      )}
                    </div>
                    <div className="play-playground-trail-actions">
                      <button
                        type="button"
                        className="spark-ide-btn spark-ide-btn--run"
                        disabled={!trailDirty}
                        onClick={saveTrailResources}
                      >
                        {trailSaveFlash ? 'Saved' : 'Save resources'}
                      </button>
                      {trailDirty && (
                        <button
                          type="button"
                          className="ghost sm"
                          onClick={() => setTrailDraft(trailSaved)}
                        >
                          Discard
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="play-playground-notes-pane">
                    <textarea
                      className="play-playground-notes-input"
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder="Scratch notes — Save to keep them for this session…"
                      spellCheck={false}
                      aria-label="Playground notes"
                    />
                    <div className="play-playground-notes-actions">
                      <button
                        type="button"
                        className="spark-ide-btn spark-ide-btn--run"
                        disabled={!notesDirty}
                        onClick={savePlaygroundNotes}
                      >
                        {notesSaveFlash ? 'Saved' : 'Save notes'}
                      </button>
                      {notesDirty && (
                        <button
                          type="button"
                          className="ghost sm"
                          onClick={() => setNotesDraft(notesSaved)}
                        >
                          Discard
                        </button>
                      )}
                    </div>
                  </div>
                )
              ) : briefTab === 'knobs' && hasKnobs ? (
                <div className="play-playground-trail-pane">
                  <p className="play-playground-trail-help">
                    Cluster size is locked. The problem setter chose which Spark settings you
                    can change; pick values from the lists and save before Run or Submit.
                  </p>
                  <div className="play-playground-trail-form">
                    {knobDefs.map((def) => (
                      <label key={def.id} className="play-playground-trail-field">
                        <span>{def.label}</span>
                        <select
                          value={knobDraft[def.id] ?? def.default}
                          onChange={(e) =>
                            setKnobDraft((prev) =>
                              normalizeKnobValues({ ...prev, [def.id]: e.target.value }, knobDefs),
                            )
                          }
                        >
                          {def.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  {knobDefs.some((d) => d.help) && (
                    <ul className="play-playground-trail-help" style={{ marginTop: 8, paddingLeft: 18 }}>
                      {knobDefs.filter((d) => d.help).map((d) => (
                        <li key={d.id}>
                          <code>{d.conf}</code>
                          {' — '}
                          {d.help}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="play-playground-trail-summary">
                    <div>
                      <span className="play-playground-trail-summary-label">Saved</span>
                      <code>{formatKnobSummary(knobSaved, knobDefs)}</code>
                    </div>
                    {knobDirty && (
                      <div>
                        <span className="play-playground-trail-summary-label">Draft</span>
                        <code>{formatKnobSummary(knobDraft, knobDefs)}</code>
                      </div>
                    )}
                  </div>
                  <div className="play-playground-trail-actions">
                    <button
                      type="button"
                      className="spark-ide-btn spark-ide-btn--run"
                      disabled={!knobDirty}
                      onClick={saveLabKnobs}
                    >
                      {knobSaveFlash ? 'Saved' : 'Save knobs'}
                    </button>
                    {knobDirty && (
                      <button
                        type="button"
                        className="ghost sm"
                        onClick={() => setKnobDraft(knobSaved)}
                      >
                        Discard
                      </button>
                    )}
                  </div>
                </div>
              ) : (
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
                                  className={`spark-submission-row${
                                    selectedJobId === sub.id && resultsOpen ? ' is-selected' : ''
                                  }`}
                                  onClick={() => {
                                    upsertJob(sub);
                                    setSelectedJobId(sub.id);
                                    setResultsOpen(true);
                                    void openJobSnapshot(sub);
                                    if (session?.id) {
                                      void fetchSparkJob(session.id, sub.id)
                                        .then((job) => {
                                          upsertJob(job);
                                          setSelectedJobId(job.id);
                                        })
                                        .catch(() => { /* keep listed snapshot */ });
                                    }
                                  }}
                                >
                                  <span className="spark-submission-name">{sub.name}</span>
                                  <span className="spark-submission-flags">
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
                                    {(() => {
                                      const pace = paceBadge(sub);
                                      return pace ? (
                                        <span className={`spark-pace-badge spark-pace-badge--${pace.tone}`}>
                                          {pace.label}
                                        </span>
                                      ) : null;
                                    })()}
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
                                    <span className="spark-submission-exec" title="Spark jobs wall from History Server">
                                      Exec {formatDurationMs(jobExecMs(sub))}
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
                          <h4>Job I/O</h4>
                          <p className="dim" style={{ fontSize: 12, margin: '4px 0 8px' }}>
                            The platform sets these environment variables for each run.
                            Read and write through them — you do not need raw storage paths.
                          </p>
                          {(platform.dualInput || platform.businessDate || platform.productsPath
                            || platform.txnInputPath || platform.rateInputPath
                            || platform.eventsInputPath || platform.catalogInputPath) && (
                            <ul className="spark-grade-list">
                              {platform.eventsInputPath || platform.catalogInputPath ? (
                                <>
                                  {platform.eventsInputPath && (
                                    <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                      Events: <code>INPUT_A_PATH</code>
                                      {platform.runEventsInputPath
                                        ? ' — Run uses a small sample; Submit uses the full drop'
                                        : ''}
                                    </li>
                                  )}
                                  {platform.catalogInputPath && (
                                    <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                      Catalog: <code>INPUT_B_PATH</code>
                                      {platform.runCatalogInputPath
                                        ? ' — Run uses a current snapshot; Submit uses the versioned catalog'
                                        : ''}
                                    </li>
                                  )}
                                </>
                              ) : (
                                platform.dualInput && (
                                  <>
                                    <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                      Input A: <code>INPUT_A_PATH</code>
                                    </li>
                                    <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                      Input B: <code>INPUT_B_PATH</code>
                                    </li>
                                  </>
                                )
                              )}
                              {platform.txnInputPath && (
                                <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  Transactions: <code>TXN_INPUT_PATH</code>
                                  {platform.runTxnInputPath ? ' — Run uses a small sample; Submit uses the full drop' : ''}
                                </li>
                              )}
                              {platform.rateInputPath && (
                                <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  Rate card: <code>RATE_INPUT_PATH</code>
                                  {platform.runRateInputPath ? ' — Run uses a pruned card that covers the sample' : ''}
                                </li>
                              )}
                              {platform.businessDate && (
                                <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  Business date: <code>BUSINESS_DATE</code>
                                  {' '}(<code>{platform.businessDate}</code>)
                                </li>
                              )}
                              {platform.productsPath && (
                                <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  Products: <code>PRODUCTS_PATH</code>
                                </li>
                              )}
                            </ul>
                          )}
                        </section>
                        {platform.limits && (
                          <section className="statement-section">
                            <h4>Job resources</h4>
                            <p className="dim" style={{ fontSize: 12, margin: '4px 0 8px' }}>
                              Locked for this lab. Applied to every Run and Submit.
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
                                  <tr>
                                    <td className="statement-table-col">Hard time limit</td>
                                    <td className="statement-table-type">
                                      {platform.limits.hardTimeoutSeconds ?? 600}s
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </section>
                        )}
                        {platform.sparkConf && Object.keys(platform.sparkConf).length > 0 && (
                          <section className="statement-section">
                            <h4>Locked Spark conf</h4>
                            <p className="dim" style={{ fontSize: 12, margin: '4px 0 8px' }}>
                              Set by the problem setter. Not tunable from the Knobs tab.
                            </p>
                            <div className="statement-table-wrap">
                              <table className="statement-table">
                                <thead>
                                  <tr>
                                    <th>Config</th>
                                    <th>Value</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.entries(platform.sparkConf).map(([key, value]) => (
                                    <tr key={key}>
                                      <td className="statement-table-col"><code>{key}</code></td>
                                      <td className="statement-table-type"><code>{value}</code></td>
                                    </tr>
                                  ))}
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
            <div className="spark-ide-actionbar-left">
              {pythonVersions.length > 0 && (
                <label className="spark-ide-file-pick">
                  <span>File</span>
                  <select
                    value={
                      pythonVersions.some((o) => o.path === runEntrypoint)
                        ? runEntrypoint
                        : (pythonVersions[0]?.path || runEntrypoint)
                    }
                    onChange={(e) => setRunEntrypoint(e.target.value)}
                    disabled={submitting}
                    title="Python file Spark will run"
                  >
                    {pythonVersions.map((opt) => (
                      <option key={opt.path} value={opt.path}>
                        {opt.label}
                      </option>
                    ))}
                    {runEntrypoint
                      && !pythonVersions.some((o) => o.path === runEntrypoint)
                      && (
                        <option value={runEntrypoint}>{runEntrypoint}</option>
                      )}
                  </select>
                </label>
              )}
              {isPlayground && (
                <button
                  type="button"
                  className="play-playground-trail-chip"
                  title="Edit resources"
                  onClick={() => {
                    setBriefCollapsed(false);
                    setBriefTab('resources');
                  }}
                >
                  Resources · {formatTrailSummary(trailSaved)}
                </button>
              )}
            </div>
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
                disabled={jobInFlight}
                title={
                  isPlayground
                    ? `Run ${runEntrypoint} · ${formatTrailSummary(trailSaved)}`
                    : `Run ${runEntrypoint}`
                }
              >
                <IconPlay color="currentColor" />
                <span>{submitting ? 'Running…' : 'Run'}</span>
              </button>
              {!isPlayground && (
                <button
                  type="button"
                  className="spark-ide-btn spark-ide-btn--submit"
                  onClick={handleSubmitJob}
                  disabled={jobInFlight}
                  title={`Submit ${runEntrypoint}`}
                >
                  <IconSubmit color="#04120c" />
                  <span>{submitting ? 'Submitting…' : 'Submit'}</span>
                </button>
              )}
              {jobInFlight && (
                <button
                  type="button"
                  className="spark-ide-btn spark-ide-btn--kill"
                  onClick={() => { void handleKillJob(); }}
                  disabled={!liveJob || killing}
                  title={
                    liveJob
                      ? `Kill ${liveJob.name || 'Spark application'}`
                      : 'Waiting for Spark application…'
                  }
                >
                  <IconStop color="currentColor" />
                  <span>{killing ? 'Killing…' : 'Kill'}</span>
                </button>
              )}
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
                previewOpenRequest={submissionPreview}
                onActivePathChange={handleActivePathChange}
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
                  <span className={`spark-job-status ${statusClass((viewingJob || latestJob).status)}`}>
                    {(viewingJob || latestJob).status}
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
                    {viewingJob?.name && (
                      <span className="spark-results-job-name" title={viewingJob.name}>
                        {viewingJob.name}
                      </span>
                    )}
                  </div>
                  <div className="spark-results-header-right">
                    {viewingJob && (
                      <div className="spark-results-meta">
                        <span className={`spark-job-status ${statusClass(viewingJob.status)}`}>
                          {viewingJob.status}
                        </span>
                        {gradeBadge(viewingJob) && (
                          <span
                            className={`spark-grade-badge ${
                              viewingJob.gradeStatus === 'passed'
                                ? 'spark-grade-badge--ok'
                                : viewingJob.gradeStatus === 'failed'
                                  ? 'spark-grade-badge--fail'
                                  : 'spark-grade-badge--run'
                            }`}
                          >
                            {gradeBadge(viewingJob)}
                          </span>
                        )}
                        {(() => {
                          const pace = paceBadge(viewingJob);
                          return pace ? (
                            <span className={`spark-pace-badge spark-pace-badge--${pace.tone}`}>
                              {pace.label}
                            </span>
                          ) : null;
                        })()}
                        <span className="spark-results-exec" title="Spark jobs wall from History Server">
                          Exec {formatDurationMs(jobExecMs(viewingJob))}
                        </span>
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

                {!viewingJob ? (
                  <div className="muted spark-results-empty">
                    Run or Submit to see job output and grading here.
                  </div>
                ) : (
                  <div className="spark-job-drawer-body">
                    {viewingJob.error && (
                      <div className="alert spark-job-error">{viewingJob.error}</div>
                    )}
                    {viewingSummary && (
                      <div className="spark-grade-summary">{viewingSummary}</div>
                    )}
                    <SparkDebugMeta job={viewingJob} />
                    <pre className="spark-job-logs">{formatJobLogs(viewingJob.logs)}</pre>
                  </div>
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
