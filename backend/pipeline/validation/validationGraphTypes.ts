'use strict';

/** Validation graph (validationSpec.graph) — action DAG + snapshots for LLM judge. */

export type ValidationGraphNodeType =
  | 'http'
  | 'exec'
  | 'wait'
  | 'fork'
  | 'join'
  | 'background'
  | 'stop';

export interface ValidationGraphNode {
  type: ValidationGraphNodeType;
  /** Human note for logs / judge context */
  note?: string;
  service?: string;
  path?: string;
  method?: string;
  port?: number;
  headers?: Record<string, string>;
  body?: unknown;
  cmd?: string | string[];
  ms?: number;
  branches?: string[];
  join?: string;
  waitFor?: string[];
  targets?: string[];
  next?: string[];
  onFail?: 'abort' | 'continue';
  /** Legacy optional check on action nodes (runner only — judge decides broken state). */
  check?: string | Record<string, unknown> | null;
  optional?: boolean;
}

export interface ValidationGraphSpec {
  entry: string;
  expectBroken?: boolean;
  nodes: Record<string, ValidationGraphNode>;
  coverage?: {
    brokenStateGoals?: string[];
  };
}

export interface ValidationGraphNodeSnapshot {
  nodeId: string;
  type: ValidationGraphNodeType;
  label: string;
  ok: boolean;
  error?: string | null;
  statusCode?: number | null;
  stdout?: string;
  stderr?: string;
  body?: string;
  snapshot?: Record<string, unknown>;
  ms?: number;
  /** Set when running validationSpec.graphs[] (one DAG per symptom). */
  symptomId?: number | string;
  symptomCheck?: string;
}

export interface ValidationGraphRunResult {
  aborted: boolean;
  abortReason?: string | null;
  expectBroken: boolean;
  snapshots: ValidationGraphNodeSnapshot[];
  nodeOutcomes: Record<string, { ok: boolean; error?: string | null; ms?: number }>;
  coverageGoals: string[];
}

/** One executable DAG derived from a single design validationSymptom. */
export interface ValidationGraphEntry {
  symptomId: number | string;
  /** Copied from draft.brokenState.validationSymptoms[].check — human observation recipe. */
  symptomCheck: string;
  graph: ValidationGraphSpec;
}

export interface ValidationGraphSuiteResult {
  aborted: boolean;
  abortReason?: string | null;
  expectBroken: boolean;
  graphs: Array<ValidationGraphRunResult & { symptomId: number | string; symptomCheck: string }>;
  snapshots: ValidationGraphNodeSnapshot[];
  coverageGoals: string[];
}
