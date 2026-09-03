// ── Shared primitive types ────────────────────────────────────────────────────

export interface UserRecord {
  id: string;
  email: string;
  name?: string | null;
  /** Authoring / content-edit access (admin login or ADMIN_EMAILS). */
  admin?: boolean;
}

export interface ValidationSpec {
  readyServices?: string[];
  terminalService?: string | null;
  metricsService?: string | null;
  metricLogFormat?: string | null;
  [key: string]: unknown;
}

/** Play runtime. compose = per-session Docker sandbox; spark-platform = shared batch cluster. */
export type SandboxType = 'compose' | 'spark-platform' | 'board';

export interface SparkPlatformLimits {
  /** Driver cores requested for each Run/Submit job. */
  driver: number;
  /** Driver memory (e.g. "1g"). Defaults to 1g when omitted. */
  driverMemory?: string;
  executors: number;
  executorCores: number;
  executorMemory: string;
  /** Adaptive Query Execution (spark.sql.adaptive.enabled). */
  aqe?: boolean;
  /** spark.sql.shuffle.partitions */
  shufflePartitions?: number;
  /** spark.sql.adaptive.skewJoin.enabled */
  skewJoin?: boolean;
  /** spark.sql.autoBroadcastJoinThreshold (Spark byte string, e.g. "-1", "10m"). */
  autoBroadcastJoinThreshold?: string;
  /** Wall-clock seconds from submit; Spark Platform watcher kills the job. */
  hardTimeoutSeconds?: number;
}

/** Metadata for batch Spark challenges (Daily Product Sales, etc.). */
export interface SparkPlatformSpec {
  /** Submit input (full / aggregate). Optional when txnInputPath + rateInputPath are set. */
  inputPath?: string;
  outputPath?: string;
  /** Author golden — challenges/<challengeId>/eval/solution.json for Submit grading. */
  evalSolutionPath: string;
  /** Run input (smoke). Falls back to inputPath when omitted. */
  runInputPath?: string;
  /** Run expected output Parquet (reference). Falls back to evalSolutionPath. */
  runEvalPath?: string;
  /** Canonical testcases/ prefix (each case has input/ + expected/). */
  testcasesPrefix?: string;
  runCases?: string[];
  submitCases?: string[];
  /** Row-diff key columns for Parquet grading (default transaction_id). */
  gradeKeys?: string[];
  /** Candidate OUTPUT_PATH shape: json file (default), parquet directory, or csv directory. */
  outputFormat?: 'json' | 'parquet' | 'csv';
  businessDate?: string;
  /** Optional dimension path injected as PRODUCTS_PATH (e.g. join labs). */
  productsPath?: string;
  /** Dimension path injected as DIM_PATH (Helix / Card Rails join labs). */
  dimPath?: string;
  /** Fact path injected as TXN_INPUT_PATH (payment / dual-fact labs). Submit uses this. */
  txnInputPath?: string;
  /** Rate-card path injected as RATE_INPUT_PATH. Submit uses this. */
  rateInputPath?: string;
  /** Run smoke fact path. Falls back to txnInputPath. */
  runTxnInputPath?: string;
  /** Run smoke rate-card path. Falls back to rateInputPath. */
  runRateInputPath?: string;
  /** Events path injected as INPUT_A_PATH. Submit uses this. */
  eventsInputPath?: string;
  /** Catalog path injected as INPUT_B_PATH. Submit uses this. */
  catalogInputPath?: string;
  /** Run smoke events path. Falls back to eventsInputPath. */
  runEventsInputPath?: string;
  /** Run smoke catalog path. Falls back to catalogInputPath. */
  runCatalogInputPath?: string;
  /** Per-challenge grader script (s3a). Receives --candidate and --reference dirs. */
  gradeScript?: string;
  /** When true, stage testcases/<id>/input/ + input_b/ as INPUT_A_PATH / INPUT_B_PATH. */
  dualInput?: boolean;
  language: 'python';
  starterFileName: string;
  limits: SparkPlatformLimits;
  /**
   * Problem-setter Spark knobs shown in the Knobs tab.
   * Learners may change these within the listed options; cluster size stays fixed.
   */
  knobs?: Array<{
    id: string;
    conf: string;
    label: string;
    help?: string;
    default: string;
    options: Array<{ value: string; label: string }>;
  }>;
  /** Fixed spark_conf applied to every Run/Submit (not learner-tunable). */
  sparkConf?: Record<string, string>;
  /** Checklist items shown in the brief (human-readable). */
  gradeChecks: string[];
  /** Per-challenge scoring. Functional match is required; then optional execution-time pace. */
  scoring?: {
    executionTime?: {
      /** Spark jobs wall used as the target (History Server). */
      targetSeconds?: number;
      targetMs?: number;
      maxPoints?: number;
      /** Extra points per second faster than the target. */
      bonusPerSecond?: number;
      /**
       * Ordered pace labels for this lab. First matching ceiling wins
       * (`executionMs < maxMs` / `maxSeconds`). Omit max* on the last band (catch-all).
       */
      bands?: Array<{
        label: string;
        tone?: 'quick' | 'brisk' | 'steady' | 'slow' | string;
        maxMs?: number | null;
        maxSeconds?: number;
      }>;
    };
  };
  /** When "minio", Play loads description/hints/spec/starter from MinIO. */
  contentSource?: 'minio' | string;
}

export interface ChallengePublic {
  id: string;
  /** Global catalog number across all platforms (1, 2, 3, …). */
  number?: number | null;
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
  category: string;
  finalized: boolean;
  /** True when this user has ≥1 submit graded passed. */
  solved?: boolean;
  /** Distinct users who have submitted this challenge. */
  submitters?: number;
  sandboxType: SandboxType | string | null;
  /** Runtime SSOT marker; "minio" means hydrate from challenges/<id>/challenge/. */
  contentSource?: 'minio' | string;
  problemStatement?: Record<string, unknown> | string | null;
  sparkPlatform?: SparkPlatformSpec | null;
  boardSpec?: PublicBoardSpec | null;
}

export type BoardLaneId = string;

export interface BoardLane {
  id: BoardLaneId;
  label: string;
  hint: string;
}

export interface PublicBoardPiece {
  id: string;
  title: string;
  blurb: string;
  kind: 'stage' | 'mechanism';
}

export interface PublicBoardSlot {
  id: string;
  optional: boolean;
  x: number;
  y: number;
}

export interface PublicBoardShadow {
  slots: PublicBoardSlot[];
  edges: BoardGraphEdge[];
}

export interface PublicBoardSpec {
  pieces: PublicBoardPiece[];
  shadow: PublicBoardShadow;
}

export interface BoardGraphNode {
  id: string;
  x: number;
  y: number;
}

export interface BoardGraphEdge {
  from: string;
  to: string;
}

export interface BoardGradeCheck {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
  required?: boolean;
  skipped?: boolean;
}

export interface BoardGradeResult {
  passed: boolean;
  summary: string;
  checks: BoardGradeCheck[];
  correctRequired: number;
  requiredCount: number;
  trapsPlaced: number;
}

export interface BoardState {
  trayOrder: string[];
  fills: Record<string, string | null>;
  nodes?: BoardGraphNode[];
  edges?: BoardGraphEdge[];
  lastGrade?: BoardGradeResult | null;
}

export interface ChallengeFull extends ChallengePublic {
  verifiedDir: string | null;
  problemStatement: Record<string, unknown> | string | null;
  validationSpec: ValidationSpec | null;
  /** Present when sandboxType === 'spark-platform'. */
  sparkPlatform?: SparkPlatformSpec | null;
  boardSpec?: PublicBoardSpec | null;
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

export interface SparkRunMetrics {
  sparkJobsDurationMs: number | null;
  sparkAppDurationMs: number | null;
  sparkJobCount: number;
  fetchedAt: number;
}

export interface SparkJobRecord {
  id: string;
  name: string;
  status: SparkJobStatus;
  mode?: 'run' | 'submit';
  submittedAt: number;
  finishedAt?: number | null;
  /** Platform wall: submit → finished (includes image pull / pod setup). */
  wallDurationMs?: number | null;
  /**
   * Spark jobs wall from History Server (first job submit → last job complete).
   * Excludes K8s/image-pull overhead; preferred execution time for playground trails.
   */
  executionDurationMs?: number | null;
  /** Full Spark application attempt duration (includes SparkContext / executor register). */
  sparkAppDurationMs?: number | null;
  sparkJobCount?: number | null;
  runMetrics?: SparkRunMetrics | null;
  logs: string[];
  error?: string | null;
  gradeStatus?: 'pending' | 'grading' | 'passed' | 'failed' | null;
  gradeResult?: {
    passed?: boolean;
    kind?: string;
    summary?: string;
    checks?: Array<{
      id: string;
      label: string;
      passed: boolean;
      detail?: string;
      skipped?: boolean;
      section?: 'functional' | 'performance';
    }>;
    sections?: {
      functional?: { passed: boolean };
      performance?: { skipped?: boolean; passed?: boolean; detail?: string };
    };
    score?: {
      functionalPassed: boolean;
      executionMs: number | null;
      targetMs?: number;
      maxPoints?: number;
      points?: number;
      bonusPerSecond?: number;
      pace?: { label: string; tone: 'quick' | 'brisk' | 'steady' | 'slow' } | null;
    };
  } | null;
  gradedAt?: number | null;
  /** Spark application id (e.g. spark-xxxx) once the cluster assigns it. */
  applicationId?: string | null;
  /** Deep link to this app on the History Server (or server root if id pending). */
  historyUrl?: string | null;
  historyServerUrl?: string | null;
  outputPath?: string | null;
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
  /** Open freeform Spark Playground (Run-only; no default INPUT_PATH). */
  onOpenSparkPlayground?: () => Promise<void>;
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
