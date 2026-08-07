// ── Shared primitive types ────────────────────────────────────────────────────

export interface UserRecord {
  id: string;
  email: string;
  name?: string | null;
}

export interface ValidationSpec {
  readyServices?: string[];
  terminalService?: string | null;
  metricsService?: string | null;
  metricLogFormat?: string | null;
  [key: string]: unknown;
}

/** Play runtime. compose = per-session Docker sandbox; spark-platform = shared batch cluster. */
export type SandboxType = 'compose' | 'spark-platform';

export interface SparkPlatformLimits {
  driver: number;
  executors: number;
  executorCores: number;
  executorMemory: string;
}

/** Metadata for batch Spark challenges (Daily Product Sales, etc.). */
export interface SparkPlatformSpec {
  inputPath: string;
  outputPath?: string;
  /** Author golden — challenges/<challengeId>/eval/solution.json for Submit grading. */
  evalSolutionPath: string;
  businessDate: string;
  language: 'python';
  starterFileName: string;
  limits: SparkPlatformLimits;
  /** Checklist items shown in the brief (human-readable). */
  gradeChecks: string[];
}

export interface ChallengePublic {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
  category: string;
  finalized: boolean;
  sandboxType: SandboxType | string | null;
  problemStatement?: Record<string, unknown> | string | null;
  sparkPlatform?: SparkPlatformSpec | null;
}

export interface ChallengeFull extends ChallengePublic {
  verifiedDir: string | null;
  problemStatement: Record<string, unknown> | string | null;
  validationSpec: ValidationSpec | null;
  /** Present when sandboxType === 'spark-platform'. */
  sparkPlatform?: SparkPlatformSpec | null;
}

// ── App-level state types ─────────────────────────────────────────────────────

export type AuthMode = 'resolving' | 'unauthenticated' | 'interviewer';

export type PlayState = 'library' | 'loading' | 'active' | 'ended';

export type WorkspaceTab =
  | 'problem'
  | 'terminal'
  | 'editor'
  | 'browser'
  | 'metrics'
  | 'jobs'
  | 'data'
  | 'grade';

export type SparkJobStatus =
  | 'idle'
  | 'submitted'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed';

export interface SparkJobRecord {
  id: string;
  name: string;
  status: SparkJobStatus;
  mode?: 'run' | 'submit';
  submittedAt: number;
  finishedAt?: number | null;
  logs: string[];
  error?: string | null;
  gradeStatus?: 'pending' | 'grading' | 'passed' | 'failed' | null;
  gradeResult?: {
    passed?: boolean;
    kind?: string;
    summary?: string;
    checks?: Array<{ id: string; label: string; passed: boolean; detail?: string }>;
  } | null;
  gradedAt?: number | null;
  /** Spark application id (e.g. spark-xxxx) once the cluster assigns it. */
  applicationId?: string | null;
  /** Deep link to this app on the History Server (or server root if id pending). */
  historyUrl?: string | null;
  historyServerUrl?: string | null;
}

export interface ActiveSession {
  id: string;
  startTime: number;
  recovered: boolean;
  terminalWsUrl: string | null;
  metricsWsUrl: string | null;
  portMap: Record<string, string | number> | null;
  services: string[];
  terminalService: string | null;
  /** Set for spark-platform sessions (no compose). */
  runtime?: SandboxType | string | null;
}

export interface EndSessionResult {
  sessionId?: string;
  elapsed?: number;
  [key: string]: unknown;
}

export interface AppState {
  authMode: AuthMode;
  currentUser: UserRecord | null;
  playState: PlayState;
  challenges: ChallengePublic[];
  challengesError: string | null;
  startError: string | null;
  activeSession: ActiveSession | null;
  activeChallenge: ChallengePublic | ChallengeFull | null;
  endResult: EndSessionResult | null;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  ending: boolean;
  onSelectChallenge: (challenge: ChallengePublic | ChallengeFull) => Promise<void>;
  onBackToLibrary: () => void;
  onEnd: () => Promise<void>;
  onLogout: () => void;
}

// ── API / service helpers ─────────────────────────────────────────────────────

export interface AuthHeader {
  Authorization?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  totalPages: number;
  page?: number;
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface MetricsSeriesPoint {
  ts: number;
  t?: string;
  latency: number;
  errors: number;
  dbCpu: number;
  [metric: string]: number | string | undefined;
}

export interface MetricsState {
  series: MetricsSeriesPoint[];
  latest: MetricsSeriesPoint | null;
  recovered: boolean;
}

// ── Re-exported React helpers ─────────────────────────────────────────────────

export type ReactNode = import('react').ReactNode;
export type FormEvent = import('react').FormEvent;
export type ChangeEvent<T = Element> = import('react').ChangeEvent<T>;
export type MouseEvent<T = Element> = import('react').MouseEvent<T>;
