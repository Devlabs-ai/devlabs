/**
 * Spark authoring shape contract (v1).
 *
 * Produced by Design Agent; consumed by Data → Code → Validation → Eval.
 * No transform.semantics in v1 (Spark read quirks handled at Eval runtime).
 */

export type SparkChallengeKind = 'implementation' | 'debug';

export type SparkDifficulty = 'easy' | 'medium' | 'hard';

export type SparkTransformPattern = 'aggregate';

export interface SparkShapeMeta {
  name: string;
  slug: string;
  difficulty: SparkDifficulty;
  tags: string[];
  category: string;
  play?: {
    domainId: string;
    panelId: string;
  };
}

export interface SparkProblemStatement {
  overview?: string;
  symptoms?: string[];
  yourTask?: string;
  yourTaskSteps?: string[];
  hints?: string[];
  inputSchema?: Array<{ column: string; type: string }>;
  expectedOutput?: Array<{ column: string; description: string }>;
}

export interface SparkBrief {
  description: string;
  problemStatement: SparkProblemStatement;
}

export interface SparkKindSpec {
  starterMode: 'stub' | 'broken';
  /** Author-only — never candidate-facing. */
  rootCause?: string;
  bugClass?: 'logic' | 'schema' | 'shuffle' | 'serialization' | 'config';
  validationSymptoms?: Array<{ id: number; check: string }>;
}

export interface SparkDataColumn {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface SparkDataBlock {
  mode: 'batch' | 'streaming';
  businessDate?: string;
  format: 'parquet' | string;
  /** Hive-style path dimensions (e.g. business_date, store_id). */
  partitions: string[];
  scale?: {
    stores?: number;
    approxRows?: number;
    productCardinality?: number;
    [key: string]: unknown;
  };
  schema: SparkDataColumn[];
  malformed?: {
    enabled: boolean;
    rate?: number;
    patterns?: string[];
  };
  /** Where gen scripts should place input under the challenge prefix. */
  inputLayout?: {
    targetPrefixHint: string;
    hiveStyle?: boolean;
  };
}

export interface SparkValidationRule {
  id: string;
  description?: string;
  expr: string;
}

export interface SparkAggregation {
  output: string;
  type: 'int' | 'float' | string;
  atol?: number;
  expr: string;
}

export interface SparkTransform {
  pattern: SparkTransformPattern;
  validationRules: SparkValidationRule[];
  groupBy: string[];
  aggregations: SparkAggregation[];
}

export interface SparkPlatform {
  language: 'python';
  starterFileName: string;
  limits: {
    driver: number;
    executors: number;
    executorCores: number;
    executorMemory: string;
  };
  gradeChecks: string[];
}

export interface SparkEvalColumn {
  name: string;
  type: string;
  role: 'key' | 'value';
  atol?: number;
}

/** What Eval harvests from the solution job and publishes as golden. */
export interface SparkEvalCollection {
  fromJob: {
    artifact: 'json';
    envOutputPath: string;
    wrapper: string;
  };
  keys: string[];
  columns: SparkEvalColumn[];
  publishAs: string;
}

export interface SparkShapeContract {
  schemaVersion: 1;
  kind: SparkChallengeKind;
  meta: SparkShapeMeta;
  brief: SparkBrief;
  kindSpec: SparkKindSpec;
  data: SparkDataBlock;
  transform: SparkTransform;
  platform: SparkPlatform;
  evalCollection: SparkEvalCollection;
}

/** Stage failures carried into the next retry of Data/Code/Eval. */
export type SparkPipelinePhase =
  | 'DESIGN'
  | 'DATA'
  | 'CODE'
  | 'VALIDATION'
  | 'EVAL';

export interface SparkStageAttempt {
  phase: SparkPipelinePhase;
  message: string;
  details?: Record<string, unknown> | null;
  rawText?: string | null;
}

export interface SparkWorkspaceLayout {
  root: string;
  gen: string;
  starter: string;
  solution: string;
  input: string;
  eval: string;
}
