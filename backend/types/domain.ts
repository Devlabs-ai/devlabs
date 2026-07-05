/** Canonical role bucket IDs for challenge library grouping. */
export type BucketId =
  | 'software-engineer'
  | 'data-engineer'
  | 'platform-engineer'
  | 'devops';

export type AuthRole = 'interviewer' | 'admin' | 'candidate';

export interface JwtPayload {
  sub?: string;
  userId?: string;
  email?: string;
  role: AuthRole;
  companyId?: string | null;
  iat?: number;
  exp?: number;
}

export interface UserRecord {
  id: string;
  email: string;
  role: AuthRole;
  companyId?: string | null;
  name?: string | null;
}

export interface InviteRecord {
  token: string;
  challengeId: string;
  name?: string | null;
  email?: string | null;
  candidateEmail?: string | null;
  challengeTitle?: string | null;
  conductedByName?: string | null;
  used?: boolean;
  expired?: boolean;
}

export interface ChallengePublic {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
  category: string;
  bucket: BucketId | null;
  finalized: boolean;
  archived: boolean;
  sandboxType: string | null;
}

export interface ChallengeFull extends ChallengePublic {
  authored_by: string | null;
  visibility: string;
  library_id: string | null;
  verifiedDir: string | null;
  problemStatement: Record<string, unknown> | string | null;
  validationSpec: ValidationSpec | null;
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
  title: string;
  description: string;
  difficulty: string;
  tags: string[] | null;
  category: string;
  bucket: string | null;
  finalized: boolean;
  archived: boolean;
  sandbox_type: string | null;
  authored_by?: string | null;
  visibility?: string;
  library_id?: string | null;
  verified_dir?: string | null;
  problem_statement?: Record<string, unknown> | string | null;
  validation_spec?: ValidationSpec | null;
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
}

export type PortMap = Record<string, string | number>;

export interface DraftMeta {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  difficulty?: string | null;
  author?: string | null;
  tags?: string[];
  catalogueCategories?: string[];
  bucket?: string | null;
}

export interface DraftInfraService {
  name: string;
  image_hint?: string | null;
  limits?: Record<string, unknown> | null;
  env_hints?: Record<string, string>;
  notes?: string;
  roles?: string[];
}

export interface DraftInfra {
  services: Array<string | DraftInfraService>;
}

export interface DraftMetrics {
  enabled?: boolean;
  service?: string | null;
  format?: string | null;
  observed?: unknown;
  observe?: ObservableSpec[];
  observeResolvedFrom?: Record<string, unknown>;
  interval_seconds?: number;
  display?: { primary?: string; secondary?: string[]; guidance?: string };
  recovery?: { latency_below_ms?: number; consecutive_samples?: number };
}

export interface DraftBrokenState {
  rootCause?: string;
  validationSymptoms?: Array<{ id?: number; order?: number; check: string; status?: string }>;
}

export interface ChallengeDraft {
  schemaVersion?: number;
  meta?: DraftMeta;
  title?: string | null;
  category?: string | null;
  difficulty?: string | null;
  tags?: string[];
  description?: string;
  infra?: DraftInfra;
  arch?: string;
  codebase?: { artifacts?: unknown[] };
  data?: Record<string, unknown>;
  metrics?: DraftMetrics;
  brokenState?: DraftBrokenState;
  sandboxSpec?: Record<string, unknown>;
  problemStatement?: Record<string, unknown> | string | null;
  readyServices?: string[];
}

export interface HttpError extends Error {
  status?: number;
  raw?: unknown;
  rawText?: string | null;
  code?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  lastFailure?: string | null;
  lastAttempt?: BuildAttempt | null;
  availableCategories?: unknown;
}

export type SpinFailureKind = 'COMPOSE_UP' | 'SERVICE_RUNTIME';

export type BuildPhase = 'CODE' | 'SPIN' | 'VALIDATE';

export interface BuildAttempt {
  phase: BuildPhase | string;
  message: string;
  artifacts?: unknown;
  rawText?: string | null;
  details?: Record<string, unknown> | null;
}

export type BuildEvent =
  | { type: 'log'; level?: string; tag?: string; message: string; detail?: unknown }
  | { type: 'thinking'; step: number; label: string }
  | { type: 'codeStep'; step: number; tools: string; hint?: string; ms: number; cost: string; tokens: string; toolCount?: number; summary?: string | null }
  | { type: 'codeDiff'; tool: string; path: string; diff: string; summary?: boolean }
  | { type: 'phase'; phase: BuildPhase | string; attempt: number; total: number }
  | { type: 'buildDir'; buildDir: string }
  | { type: 'validation'; result: ValidationResult }
  | { type: 'done'; buildSessionId: string; builtChallenge: unknown; buildValidation: unknown; terminalWsUrl?: string | null; metricsWsUrl?: string | null }
  | { type: 'error'; message: string }
  | { type: 'iteration'; [key: string]: unknown }
  | Record<string, unknown>;

export type BuildEventHandler = (event: BuildEvent) => void;

export interface ValidationResult {
  passed: boolean;
  feedback?: string;
  suggestions?: string[];
  evidence?: Array<Record<string, unknown>>;
  checklist?: unknown[];
  llmUsage?: unknown;
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

export interface ReviewRecord {
  sessionId: string;
  title?: string;
  builtChallenge?: ChallengeFull | Record<string, unknown>;
  buildValidation?: { passed?: boolean; [key: string]: unknown };
  sandboxTouched?: boolean;
  [key: string]: unknown;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Validation step
// ---------------------------------------------------------------------------

export interface ValidationStep {
  type: 'http' | 'exec' | string;
  service?: string;
  path?: string;
  method?: string;
  port?: number;
  cmd?: string | string[];
  check?: string | Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  id: string;
  kind: 'symptom' | 'step' | 'judge';
  order?: number;
  label: string;
  status: 'pending' | 'pass' | 'fail' | 'skip';
  detail: string | null;
}

export interface IterationCost {
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export interface ObservableSpec {
  id: string;
  algorithm: string;
  field: string;
  segment?: string;
  requires?: {
    roles?: string[];
    infra?: string[];
    serviceNames?: string[];
    anyRole?: string[];
  };
}

export interface CatalogueEntry {
  id?: number;
  category: string;
  image?: string | null;
  imageHints?: string[];
  port?: number | null;
  dos?: string[];
  donts?: string[];
  conf?: Record<string, unknown>;
  defaultLimits?: Record<string, string> | null;
  handbookText?: string | null;
  metricFormat?: string | null;
  observables?: ObservableSpec[];
}

export interface ServiceSpec {
  name: string;
  image_hint?: string | null;
  limits?: Record<string, string> | null;
  env_hints?: Record<string, string>;
  notes?: string;
  roles?: string[];
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

export type LessonPhase = 'spin' | 'validate';

export interface LessonRecord {
  id: number;
  phase: LessonPhase;
  failureSummary: string;
  fixSummary: string;
  category: string | null;
  title: string | null;
  distance: number | null;
}

/** One lesson entry injected into the CODE agent repair payload. */
export interface RelatedLesson {
  phase: LessonPhase;
  failureSummary: string | null | undefined;
  fixSummary: string | null | undefined;
  category: string | null;
  similarity: number | null;
}

export interface LessonsBlock {
  relatedLessons: RelatedLesson[];
}

/** First failure in a SPIN/VALIDATE window — anchor for failure_summary at record time. */
export interface LessonAnchorFailure {
  attempt: number;
  phase: string;
  message: string | null;
  failureKind?: string | null;
  psSnapshot?: string | null;
  feedback?: string | null;
  suggestions?: string[];
  extractedErrors?: string[];
}

// ---------------------------------------------------------------------------
// Draft sessions
// ---------------------------------------------------------------------------

export type BuildStatus = 'building' | 'review_ready' | 'failed' | null;

export interface DraftSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  authoredBy: string | null;
  messages: Array<{ role: string; content: string }>;
  draft: ChallengeDraft | null;
  shapePhase: string;
  designApproved: boolean;
  schemaMaterialized: boolean;
  testSessionId: string | null;
  buildStatus: BuildStatus;
  buildSessionId: string | null;
  buildDir: string | null;
  buildAttempts: number;
  buildLogs: unknown[];
  builtChallenge: Record<string, unknown> | null;
  buildValidation: (ValidationResult & { llmUsage?: unknown }) | null;
  buildCurrentPhase: string | null;
  buildCurrentAttempt: number;
  reviewFeedback: unknown;
  buildChecklists?: unknown[];
  buildLatestChecklist?: unknown;
  buildFailedDir?: string | null;
  buildFailedSessionId?: string | null;
  buildFailedPhase?: string | null;
  buildFailedMsg?: string | null;
}

// ---------------------------------------------------------------------------
// Built challenge (output of a successful build pipeline run)
// ---------------------------------------------------------------------------

export interface BuiltChallenge {
  id: string | null;
  title: string;
  description: string;
  difficulty: string;
  category: string;
  tags: string[];
  finalized: boolean;
  sandboxType: string;
  problemStatement: Record<string, unknown> | string | null;
  validationSpec: ValidationSpec | null;
  buildSessionId: string;
  buildDir: string;
  portMap: PortMap;
  metrics?: DraftMetrics;
  arch?: string;
  meta?: DraftMeta;
}

