// ── Shared primitive types ────────────────────────────────────────────────────

export type AuthRole = 'interviewer' | 'admin' | 'candidate';

export type BucketId =
  | 'software-engineer'
  | 'data-engineer'
  | 'platform-engineer'
  | 'devops';

// ── Entity records ────────────────────────────────────────────────────────────

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

export interface ValidationSpec {
  readyServices?: string[];
  terminalService?: string | null;
  metricsService?: string | null;
  metricLogFormat?: string | null;
  [key: string]: unknown;
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
  /** Present when the server returns full records to authenticated interviewers. */
  authored_by?: string | null;
  visibility?: string;
}

export interface ChallengeFull extends ChallengePublic {
  authored_by: string | null;
  visibility: string;
  library_id: string | null;
  verifiedDir: string | null;
  problemStatement: Record<string, unknown> | string | null;
  validationSpec: ValidationSpec | null;
}

// ── App-level state types ─────────────────────────────────────────────────────

export type AuthMode = 'resolving' | 'unauthenticated' | 'interviewer' | 'candidate';

export type PlayState = 'library' | 'loading' | 'active' | 'ended';

export type WorkspaceTab = 'problem' | 'terminal' | 'editor' | 'browser' | 'metrics';

export interface ActiveSession {
  id: string;
  startTime: number;
  recovered: boolean;
  terminalWsUrl: string | null;
  metricsWsUrl: string | null;
  portMap: Record<string, string | number> | null;
  services: string[];
  terminalService: string | null;
}

export interface EndSessionResult {
  sessionId?: string;
  elapsed?: number;
  [key: string]: unknown;
}

export interface AppState {
  authMode: AuthMode;
  currentUser: UserRecord | null;
  candidateInvite: (InviteRecord & { token?: string }) | null;
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
  onPromoted: () => Promise<void>;
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

// ── Review ────────────────────────────────────────────────────────────────────

export interface ReviewFeedbackPayload {
  observations?: string;
  tags?: string[];
  severity?: string;
}

export interface ReviewRecord {
  sessionId: string;
  title?: string;
  builtChallenge?: ChallengeFull | Record<string, unknown>;
  buildValidation?: { passed?: boolean; feedback?: string; suggestions?: string[]; [key: string]: unknown };
  sandboxTouched?: boolean;
  buildDir?: string | null;
  savedAt?: string;
  reviewFeedback?: ReviewFeedbackEntry | null;
  [key: string]: unknown;
}

export interface ReviewFeedbackEntry {
  observations?: string;
  tags?: string[];
  severity?: string;
  submittedAt?: string | number;
}

// ── Problem / pipeline ────────────────────────────────────────────────────────

export interface ProblemStreamOptions {
  signal?: AbortSignal;
}

export interface BuildLogEntry {
  level?: string;
  tag?: string;
  message: string;
  detail?: unknown;
  ts?: number;
}

export interface ValidationChecklistItem {
  id?: string;
  label?: string;
  status?: 'pass' | 'fail' | 'skip' | 'pending' | string;
  [key: string]: unknown;
}

export interface PipelineChecklist {
  attempt: number;
  failedPhase?: string | null;
  validation?: { passed?: boolean; checklist?: ValidationChecklistItem[] };
  [key: string]: unknown;
}

// ── Draft / authoring ─────────────────────────────────────────────────────────

export interface DraftMeta {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  difficulty?: string | null;
  author?: string | null;
  tags?: string[];
  catalogueCategories?: string[];
  description?: string;
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
  observe?: unknown[];
  display?: { guidance?: string };
}

export interface DraftBrokenState {
  rootCause?: string;
  validationSymptoms?: Array<{ order?: number; check: string; status?: string }>;
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
}

export interface ProblemSession {
  id: string;
  draft?: ChallengeDraft | null;
  messages?: Array<{ role: string; content: string }>;
  buildStatus?: string | null;
  buildLogs?: string[];
  buildCurrentPhase?: string | null;
  buildCurrentAttempt?: number;
  buildAttempts?: number;
  buildValidation?: unknown;
  buildLatestChecklist?: unknown;
  buildChecklists?: unknown[];
  buildDir?: string | null;
  buildFailedDir?: string | null;
  buildFailedPhase?: string | null;
  buildSessionId?: string | null;
  builtChallenge?: ChallengeFull | null;
  draftReady?: boolean;
  shapePhase?: string;
  designApproved?: boolean;
  schemaMaterialized?: boolean;
  shapeContractComplete?: boolean;
  shapeContractMissing?: string[];
  reviewFeedback?: ReviewFeedbackEntry | null;
  updatedAt?: string;
}

// ── Pricing ───────────────────────────────────────────────────────────────────

export interface PricingPlan {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  ctaType: string;
  highlighted: boolean;
}

// ── Re-exported React helpers ─────────────────────────────────────────────────

export type ReactNode = import('react').ReactNode;
export type FormEvent = import('react').FormEvent;
export type ChangeEvent<T = Element> = import('react').ChangeEvent<T>;
export type MouseEvent<T = Element> = import('react').MouseEvent<T>;
