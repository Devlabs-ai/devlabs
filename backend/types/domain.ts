export interface JwtPayload {
  sub?: string;
  userId?: string;
  email?: string;
  admin?: boolean;
  role?: 'admin' | 'reviewer' | 'learner';
  reviewTracks?: string[];
  iat?: number;
  exp?: number;
}

export interface UserRecord {
  id: string;
  email: string;
  name?: string | null;
  status?: 'pending' | 'active' | 'rejected';
  role?: 'admin' | 'reviewer' | 'learner';
  reviewTracks?: string[];
  isAdmin?: boolean;
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
  sandboxType: string | null;
  /**
   * Who may open this lab.
   * - admin: admins only
   * - reviewers: reviewers + admin
   * - users: learners + reviewers + admin
   */
  visibleTo?: 'admin' | 'reviewers' | 'users';
  /** Admin-only notes on the Visibility tab. */
  visibilityNotes?: string;
  /** Reward tokens earned when the lab is solved. */
  tokens?: number;
}

export interface SparkPlatformSpec {
  inputPath?: string;
  outputPath?: string;
  evalSolutionPath: string;
  /** Run smoke input; optional — defaults to inputPath. */
  runInputPath?: string;
  /** Run expected Parquet prefix (reference). */
  runEvalPath?: string;
  testcasesPrefix?: string;
  runCases?: string[];
  submitCases?: string[];
  gradeKeys?: string[];
  outputFormat?: 'json' | 'parquet' | 'csv';
  businessDate?: string;
  productsPath?: string;
  /** Dimension path injected as DIM_PATH (fact-to-dim join labs). */
  dimPath?: string;
  txnInputPath?: string;
  rateInputPath?: string;
  /** Run smoke fact; falls back to txnInputPath. */
  runTxnInputPath?: string;
  /** Run smoke rate card; falls back to rateInputPath. */
  runRateInputPath?: string;
  /** Events path injected as INPUT_A_PATH. Submit uses this. */
  eventsInputPath?: string;
  /** Catalog path injected as INPUT_B_PATH. Submit uses this. */
  catalogInputPath?: string;
  /** Run smoke events path. Falls back to eventsInputPath. */
  runEventsInputPath?: string;
  /** Run smoke catalog path. Falls back to catalogInputPath. */
  runCatalogInputPath?: string;
  /** Job I/O label for INPUT_A_PATH. Defaults to "Events". */
  inputALabel?: string;
  /** Job I/O label for INPUT_B_PATH. Defaults to "Catalog". */
  inputBLabel?: string;
  /** Structured Streaming lab — platform injects CHECKPOINT_PATH. */
  streaming?: boolean;
  gradeScript?: string;
  dualInput?: boolean;
  language: 'python';
  starterFileName: string;
  limits: {
    driver: number;
    driverMemory?: string;
    executors: number;
    executorCores: number;
    executorMemory: string;
    aqe?: boolean;
    shufflePartitions?: number;
    skewJoin?: boolean;
    autoBroadcastJoinThreshold?: string;
    /** Cluster watcher kills the SparkApplication after this many seconds. */
    hardTimeoutSeconds?: number;
  };
  /** Learner-tunable Spark configs declared by the problem setter. */
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
  gradeChecks: string[];
  scoring?: {
    executionTime?: {
      targetSeconds?: number;
      targetMs?: number;
      maxPoints?: number;
      /** Extra points per whole/fractional second under targetSeconds. */
      bonusPerSecond?: number;
      bands?: Array<{
        label: string;
        tone?: string;
        maxMs?: number | null;
        maxSeconds?: number;
      }>;
    };
  };
  [key: string]: unknown;
}

/** Per-container LimitRange knobs (merged over platform defaults). */
export interface K8sLimitRangeSpec {
  defaultRequest?: { cpu?: string; memory?: string };
  default?: { cpu?: string; memory?: string };
  max?: { cpu?: string; memory?: string };
  min?: { cpu?: string; memory?: string };
}

/** Namespaced Kubernetes lab (per-user Namespace + setup/grade scripts). */
export interface K8sPlatformSpec {
  /**
   * Namespace ResourceQuota hard caps. Legacy cpu/memory apply to both requests
   * and limits; requests/limits override them per side.
   */
  quota?: {
    pods?: string;
    cpu?: string;
    memory?: string;
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
  /** Optional LimitRange overrides (defaults applied when omitted). */
  limitRange?: K8sLimitRangeSpec;
  /** Pods held as reserved balloon slots while the lab is open (default quota pods − 3). */
  reservePods?: number;
  /** Balloon slots (40m / 64Mi each) one lab pod needs when it is larger (default 1). */
  slotsPerPod?: number;
  setup?: { script?: string };
  grade?: { script?: string; timeoutSeconds?: number };
  /** Hands-on only: no Submit, no grading, no tokens or leaderboard credit. */
  practice?: boolean;
  /** sandboxType "linux" / "docker" only: the learner machine (workspace/linuxBox). */
  box?: LinuxBoxSpec;
  [key: string]: unknown;
}

/** Box labs: "linux" is the plain machine, "docker" the same machine running dockerd. */
export type BoxFlavor = 'linux' | 'docker';

export interface LinuxBoxSpec {
  /** Defaults to the flavor's image: LINUX_LAB_IMAGE / DOCKER_LAB_IMAGE. */
  image?: string;
  hostname?: string;
  /**
   * linux flavor only: run the box without systemd or the added capabilities, for
   * no-root labs (the free shell/file-navigation set). Keeps only the caps needed to
   * seed the lab and switch to the learner; drops SYS_ADMIN/NET_ADMIN and the custom
   * seccomp profile, shrinking the kernel attack surface for the untrusted free tier.
   */
  unprivileged?: boolean;
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
}

export type BoardLaneId = string;

export interface BoardLane {
  id: BoardLaneId;
  label: string;
  hint: string;
}

export interface BoardPiece {
  id: string;
  title: string;
  blurb: string;
  kind: 'stage' | 'mechanism';
  gold: 'required' | 'optional' | 'tray';
  /** Gold incoming nodes. Empty = root. */
  parents: string[];
  /** Optional splice: if this node is placed, it sits on the gold edge parent → child. */
  child: string | null;
  trapIfPlaced: string | null;
  /** Short question shown on this piece's slot, e.g. "On every write · survive a crash". */
  prompt: string | null;
  /** Unlock mode: revealed once this piece's step is locked in. */
  clue: string | null;
  /** Debate mode: who said this card's claim. */
  speaker: string | null;
}

/**
 * classic — place everything, then submit.
 * unlock  — one required step at a time; each correct step reveals its clue.
 * debate  — mark every card's claim true/false first, then build from the true ones.
 */
export type BoardGameMode = 'classic' | 'unlock' | 'debate';

export interface BoardGameConfig {
  mode: BoardGameMode;
  /** Mistakes allowed before the board must be reset. Null = unlimited, no stars. */
  lives: number | null;
}

export interface BoardFinaleOption {
  id: string;
  label: string;
}

/** Closing multiple-choice question, asked once the board itself is correct. */
export interface BoardFinale {
  prompt: string;
  options: BoardFinaleOption[];
  answer: string;
  explanation: string;
}

export interface BoardSpec {
  pieces: BoardPiece[];
  /** Workspace header label, e.g. "Replication · Order the failover". */
  kicker?: string | null;
  /** Grade summary shown when every block is correct. */
  passMessage?: string | null;
  game?: BoardGameConfig;
  finale?: BoardFinale | null;
  /** Heading for the unused-card tray, e.g. "Evidence". */
  trayLabel?: string | null;
  /** Challenge id that must be solved before this board opens. */
  unlockAfter?: string | null;
}

export interface PublicBoardPiece {
  id: string;
  title: string;
  blurb: string;
  kind: 'stage' | 'mechanism';
  speaker?: string | null;
}

export interface PublicBoardSlot {
  id: string;
  optional: boolean;
  x: number;
  y: number;
  prompt?: string | null;
}

export interface PublicBoardShadow {
  slots: PublicBoardSlot[];
  edges: BoardGraphEdge[];
}

export interface PublicBoardSpec {
  pieces: PublicBoardPiece[];
  shadow: PublicBoardShadow;
  kicker?: string | null;
  game?: BoardGameConfig;
  finale?: { prompt: string; options: BoardFinaleOption[] } | null;
  trayLabel?: string | null;
  unlockAfter?: string | null;
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

/** @deprecated lane bins — coerced into a graph when loading old sessions. */
export interface BoardPlacement {
  id: string;
  lane: BoardLaneId;
  order: number;
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
  /** Blocks are all correct (the finale may still be open). */
  boardPassed?: boolean;
  needsFinale?: boolean;
  /** 1–3 when the board has lives and is passed. */
  stars?: number | null;
}

export interface BoardClaimResult {
  verdict: boolean;
  correct: boolean;
  /** Why the claim is false; only for false claims. */
  explanation: string | null;
}

export interface BoardGameState {
  lives: number | null;
  livesMax: number | null;
  /** Unlock mode: number of required steps locked in. */
  step: number;
  clues: string[];
  /** Debate mode: verdicts once submitted. */
  claims: Record<string, BoardClaimResult> | null;
  finaleCorrect: boolean;
  finaleExplanation: string | null;
  resets: number;
  over: boolean;
}

export interface BoardState {
  trayOrder: string[];
  /** slot id → piece id. Empty slots are omitted or null. */
  fills: Record<string, string | null>;
  nodes?: BoardGraphNode[];
  edges?: BoardGraphEdge[];
  lastGrade?: BoardGradeResult | null;
  game?: BoardGameState;
}

export interface ChallengeFull extends ChallengePublic {
  verifiedDir: string | null;
  problemStatement: Record<string, unknown> | string | null;
  validationSpec: ValidationSpec | null;
  /** Mapped from platform_spec when sandboxType is spark-platform. */
  sparkPlatform?: SparkPlatformSpec | null;
  /** Mapped from platform_spec when sandboxType is kubernetes. */
  k8sPlatform?: K8sPlatformSpec | null;
  /** Full spec (with gold) in cache; public APIs strip gold. */
  boardSpec?: BoardSpec | PublicBoardSpec | null;
}

export interface ValidationSpec {
  readyServices?: string[];
  terminalService?: string | null;
  metricsService?: string | null;
  metricLogFormat?: string | null;
  steps?: ValidationStep[];
  [key: string]: unknown;
}

export interface ChallengeRow {
  id: string;
  number?: number | null;
  title: string;
  description: string;
  difficulty: string;
  tags: string[] | null;
  category: string;
  finalized: boolean;
  sandbox_type: string | null;
  verified_dir?: string | null;
  problem_statement?: Record<string, unknown> | string | null;
  validation_spec?: ValidationSpec | null;
  platform_spec?: Record<string, unknown> | SparkPlatformSpec | null;
  visible_to?: string | null;
  visibility_notes?: string | null;
  bounty?: number | null;
  tokens?: number | null;
}

export type SessionStatus = 'pending' | 'active' | 'ended';

export interface GameSession {
  id: string;
  status: SessionStatus;
  startTime: number;
  endTime: number | null;
  containerIds: string[];
  networkId: string | null;
  ports: unknown;
  recovered: boolean;
  recoveryCounter: number;
  candidateName: string | null;
  challengeId: string | null;
  buildDir: string | null;
  portMap: PortMap | null;
  metricsService: string | null;
  terminalService: string | null;
  services: string[];
  commandHistory: unknown[];
  challenge?: ChallengePublic | ChallengeFull | null;
  /** compose | spark-platform | board | kubernetes */
  runtime?: string | null;
  userId?: string | null;
  workspacePrefix?: string | null;
  /** Learner Namespace name when runtime === kubernetes (also stored in workspacePrefix). */
  k8sNamespace?: string | null;
  entrypoint?: string | null;
  workspaceUpdatedAt?: number | null;
  boardState?: BoardState | null;
  /** Last user activity (API / terminal). Used for idle timeout. */
  lastActivityAt?: number | null;
}

export type PortMap = Record<string, string | number>;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ValidationStep {
  type: 'http' | 'exec' | string;
  service?: string;
  path?: string;
  method?: string;
  port?: number;
  cmd?: string | string[];
  check?: string | Record<string, unknown> | null;
}

export interface ComposeRunOptions {
  cwd?: string;
  env?: Record<string, string>;
  captureOutput?: boolean;
  stdout?: boolean;
}

export interface ComposeRunResult {
  stdout?: string;
  stderr?: string;
}
