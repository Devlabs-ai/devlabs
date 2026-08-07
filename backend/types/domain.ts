export interface JwtPayload {
  sub?: string;
  userId?: string;
  email?: string;
  iat?: number;
  exp?: number;
}

export interface UserRecord {
  id: string;
  email: string;
  name?: string | null;
}

export interface ChallengePublic {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
  category: string;
  finalized: boolean;
  sandboxType: string | null;
}

export interface SparkPlatformSpec {
  inputPath: string;
  outputPath?: string;
  evalSolutionPath: string;
  businessDate: string;
  language: 'python';
  starterFileName: string;
  limits: {
    driver: number;
    executors: number;
    executorCores: number;
    executorMemory: string;
  };
  gradeChecks: string[];
  [key: string]: unknown;
}

export interface ChallengeFull extends ChallengePublic {
  verifiedDir: string | null;
  problemStatement: Record<string, unknown> | string | null;
  validationSpec: ValidationSpec | null;
  /** Mapped from platform_spec when sandboxType is spark-platform. */
  sparkPlatform?: SparkPlatformSpec | null;
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
  finalized: boolean;
  sandbox_type: string | null;
  verified_dir?: string | null;
  problem_statement?: Record<string, unknown> | string | null;
  validation_spec?: ValidationSpec | null;
  platform_spec?: Record<string, unknown> | SparkPlatformSpec | null;
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
  /** compose | spark-platform */
  runtime?: string | null;
  userId?: string | null;
  workspacePrefix?: string | null;
  entrypoint?: string | null;
  workspaceUpdatedAt?: number | null;
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
