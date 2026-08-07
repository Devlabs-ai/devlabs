/** Spark shape contract (subset used by authoring UI). */
export interface SparkShapeView {
  schemaVersion?: number;
  kind?: string;
  meta?: {
    name?: string;
    slug?: string;
    difficulty?: string;
    tags?: string[];
    category?: string;
  };
  brief?: {
    description?: string;
    problemStatement?: {
      overview?: string;
      yourTask?: string;
      symptoms?: string[];
    };
  };
  data?: {
    mode?: string;
    businessDate?: string;
    format?: string;
    partitions?: string[];
    scale?: Record<string, unknown>;
  };
  platform?: {
    language?: string;
    starterFileName?: string;
  };
  evalCollection?: {
    publishAs?: string;
  };
  kindSpec?: {
    starterMode?: string;
  };
}

export interface SparkDraft {
  id: string;
  authoredBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  authoringKind?: string;
  title?: string;
  sparkShape?: SparkShapeView | null;
  sparkShapeApproved?: boolean;
  buildStatus?: string | null;
  buildDir?: string | null;
  buildAttempts?: number;
  buildLogs?: string[];
  buildCurrentPhase?: string | null;
  buildCurrentAttempt?: number | null;
  builtChallenge?: { challengeId?: string; id?: string; evalPath?: string } | null;
  buildValidation?: { passed?: boolean } | null;
  buildFailedMsg?: string | null;
}
