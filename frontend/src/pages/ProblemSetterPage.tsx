import React, { useEffect, useRef, useState } from 'react';
import MarkdownProse from '../components/MarkdownProse';
import { ChecklistPhaseTracker, PhaseTracker, SPARK_PIPELINE_PHASES, type ChecklistEntry } from '../components/PhaseTracker';
import { DesignValidationChecklist } from '../components/ValidationChecklist';
import {
  streamChat,
  approveDesign,
  reviseDesign,
  generateSchema,
  uploadSparkShape,
} from '../services/problemApi';
import type { ProblemSession, ChallengeDraft } from '../types/domain';
import { formatChatForDisplay } from '../utils/chatDisplaySanitizer';

interface LlmConfig {
  llmConfigured: boolean;
  maxIterations?: number;
  provider?: string;
}

interface ProblemSetterPageProps {
  draft: ProblemSession | null;
  llmConfig: LlmConfig | null;
  onGoPipelineLogs: (attempt?: number) => void;
  onGoBuild: () => void;
  /** Open Build tab without auto-starting (publish / inspect). */
  onGoPipeline?: () => void;
  onGoReview?: () => void;
  onDraftChanged: (draft: ProblemSession) => void;
  onImportDraft: (json: string | object) => void;
  onDeleteDraft: (id: string) => void;
  onRefreshSession?: () => Promise<void>;
}

interface EmptyProps {
  onImport: (json: string | object) => void;
}

function Empty({ onImport }: EmptyProps): JSX.Element {
  const [text, setText] = useState<string>('');
  const [showImport, setShowImport] = useState<boolean>(false);
  return (
    <div className="authoring-empty setter-empty">
      <div className="authoring-empty-icon" aria-hidden>✎</div>
      <div className="authoring-empty-copy">
        <h2>Shape your challenge</h2>
        <p>Select a draft from the library, create a new one, or import JSON to get started.</p>
      </div>
      {showImport ? (
        <div className="import-box">
          <textarea
            placeholder='{ "schemaVersion": 1, "meta": { ... }, "description": "...", ... }'
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setShowImport(false)}>Cancel</button>
            <button type="button" onClick={() => onImport(text)} disabled={!text.trim()}>Import draft</button>
          </div>
        </div>
      ) : (
        <button type="button" className="ghost" onClick={() => setShowImport(true)}>Import draft JSON…</button>
      )}
    </div>
  );
}

interface ChatBubbleProps {
  role: string;
  content: string;
}

function ChatBubble({ role, content }: ChatBubbleProps): JSX.Element | null {
  const display = role === 'assistant' ? formatChatForDisplay(content) : content;
  if (role === 'assistant' && !display) return null;

  return (
    <div className={`chat-bubble ${role}`}>
      <div className="role">{role}</div>
      <div className="content">
        {role === 'assistant' ? (
          <MarkdownProse text={display} className="chat-prose markdown-prose" />
        ) : (
          display
        )}
      </div>
    </div>
  );
}

function ChatPendingBubble({ message }: { message: string }): JSX.Element {
  return (
    <div className="chat-bubble assistant chat-bubble--pending">
      <div className="role">assistant</div>
      <div className="content dim">{message}</div>
    </div>
  );
}

const PIPELINE_HISTORY_PAGE_SIZE = 10;

interface PipelineHistoryRailProps {
  draft: ProblemSession;
  onGoPipelineLogs: (attempt?: number) => void;
}

function PipelineHistoryRail({ draft, onGoPipelineLogs }: PipelineHistoryRailProps): JSX.Element {
  const [page, setPage] = useState<number>(0);
  const status = draft?.buildStatus || 'draft';
  const checklists = [...(draft?.buildChecklists || [])].reverse() as ChecklistEntry[];
  const attempts = draft?.buildAttempts || 0;
  const maxAttempts = (draft?.buildLatestChecklist as { total?: number } | undefined)?.total
    || (checklists[0] as { total?: number } | undefined)?.total
    || (isSparkSession(draft) ? 2 : 5);
  const hasRuns = status !== 'draft' && status != null && status !== '';
  const isBuilding = status === 'building';
  const spark = isSparkSession(draft);
  const passed = status === 'review_ready';
  const failed = status === 'failed';

  useEffect(() => {
    setPage(0);
  }, [draft?.id]);

  const totalPages = Math.max(1, Math.ceil(checklists.length / PIPELINE_HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageChecklists = checklists.slice(
    safePage * PIPELINE_HISTORY_PAGE_SIZE,
    safePage * PIPELINE_HISTORY_PAGE_SIZE + PIPELINE_HISTORY_PAGE_SIZE,
  );

  return (
    <div className="pipeline-history">
      {!hasRuns && checklists.length === 0 ? (
        <p className="setter-rail-empty">No pipeline runs for this draft yet.</p>
      ) : (
        <>
          {isBuilding && (
            <section className="pipeline-history-section">
              <h4 className="pipeline-history-section-title">Current run</h4>
              <PhaseTracker
                phase={draft.buildCurrentPhase}
                attempt={draft.buildCurrentAttempt || attempts || 1}
                total={maxAttempts}
                status="building"
                validation={draft.buildValidation as { passed?: boolean } | null}
                running
                attemptLabelOnly
                phaseOrder={spark ? SPARK_PIPELINE_PHASES : undefined}
                onSelect={onGoPipelineLogs}
              />
            </section>
          )}

          {!isBuilding && hasRuns && (
            <section className="pipeline-history-section">
              <h4 className="pipeline-history-section-title">Latest build</h4>
              <div className={`pipeline-history-summary ${passed ? 'ok' : failed ? 'bad' : ''}`}>
                <div className="pipeline-history-summary-row">
                  <span className="pipeline-history-summary-status">
                    {passed ? 'Passed' : failed ? 'Failed' : status}
                  </span>
                  {attempts > 0 && (
                    <span className="dim">
                      {attempts} attempt{attempts === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                {draft.buildFailedPhase && (
                  <p className="pipeline-history-summary-meta dim">
                    Phase <code>{draft.buildFailedPhase}</code>
                  </p>
                )}
                {failed && draft.buildFailedMsg && (
                  <p className="pipeline-history-summary-msg">{draft.buildFailedMsg}</p>
                )}
                {passed && (
                  <p className="pipeline-history-summary-meta dim">
                    {spark ? 'Data → Code → Validate → Eval completed.' : 'Build validation passed.'}
                  </p>
                )}
                <button
                  type="button"
                  className="sm"
                  onClick={() => onGoPipelineLogs()}
                >
                  View build logs
                </button>
              </div>
            </section>
          )}

          {checklists.length > 0 && (
            <section className="pipeline-history-section">
              <div className="pipeline-history-section-head">
                <h4 className="pipeline-history-section-title">Iterations</h4>
                {checklists.length > PIPELINE_HISTORY_PAGE_SIZE && (
                  <span className="pipeline-history-count dim">
                    {checklists.length} total
                  </span>
                )}
              </div>
              <div className="pipeline-history-trackers">
                {pageChecklists.map((c) => (
                  <ChecklistPhaseTracker
                    key={`iter-${c.attempt}-${c.failedPhase || 'ok'}`}
                    checklist={c}
                    onSelect={onGoPipelineLogs}
                  />
                ))}
              </div>
              {checklists.length > PIPELINE_HISTORY_PAGE_SIZE && (
                <div className="pipeline-history-pagination">
                  <button
                    type="button"
                    className="ghost sm"
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </button>
                  <span className="pipeline-history-page-label">
                    {safePage + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="ghost sm"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function isDraftBuildReadyLocal(d: ChallengeDraft | null | undefined): boolean {
  if (!d?.description?.trim()) return false;
  if (!d?.brokenState?.rootCause?.trim()) return false;
  const services = d?.infra?.services || [];
  if (!services.length) return false;
  return services.every((s) => {
    const svc = typeof s === 'string' ? { name: s } : s;
    return !!(typeof svc === 'object' && 'image_hint' in svc && (svc as { image_hint?: string }).image_hint?.trim());
  });
}

function isBuildSucceeded(draft: ProblemSession | null): boolean {
  if (!draft) return false;
  if (draft.buildStatus === 'review_ready') return true;
  if (draft.buildStatus === 'building') return false;
  const checklists = (draft.buildChecklists || []) as Array<{ attempt?: number; passed?: boolean }>;
  if (!checklists.length) return false;
  const latest = checklists.reduce(
    (best, c) => ((c.attempt || 0) > (best?.attempt || 0) ? c : best),
    null as { attempt?: number; passed?: boolean } | null,
  );
  return !!latest?.passed;
}

function isShapeContractCompleteLocal(d: ChallengeDraft | null | undefined): boolean {
  if (!d) return false;
  if (!d.description?.trim()) return false;
  const cats = (d.meta?.catalogueCategories || []).filter((c) => c !== 'global');
  if (!cats.length) return false;
  if (!d.meta?.name?.trim()) return false;
  if (!d.meta?.category?.trim()) return false;
  if (!d.meta?.difficulty?.trim()) return false;
  if (!d.arch?.trim()) return false;
  if (!d.brokenState?.rootCause?.trim()) return false;
  if (!(d.brokenState?.validationSymptoms?.length)) return false;
  if (!(d.infra?.services?.length)) return false;
  return true;
}

function shapeContractMissingLocal(d: ChallengeDraft | null | undefined): string[] {
  const missing: string[] = [];
  if (!d?.description?.trim()) missing.push('description');
  const cats = (d?.meta?.catalogueCategories || []).filter((c) => c !== 'global');
  if (!cats.length) missing.push('meta.catalogueCategories');
  if (!d?.meta?.name?.trim()) missing.push('meta.name');
  if (!d?.meta?.category?.trim()) missing.push('meta.category');
  if (!d?.meta?.difficulty?.trim()) missing.push('meta.difficulty');
  if (!d?.arch?.trim()) missing.push('arch');
  if (!d?.brokenState?.rootCause?.trim()) missing.push('brokenState.rootCause');
  if (!(d?.brokenState?.validationSymptoms?.length)) missing.push('brokenState.validationSymptoms');
  if (!(d?.infra?.services?.length)) missing.push('infra.services');
  return missing;
}

function isSparkSession(draft: ProblemSession | null | undefined): boolean {
  return (draft?.authoringKind || draft?.draft?.authoringKind) === 'spark-platform';
}

type ShapePhase = 'design' | 'schema' | 'ready' | string;

interface PhaseBadgeProps {
  shapePhase: ShapePhase;
  designApproved: boolean;
  draftReady: boolean;
  schemaMaterialized: boolean;
  spark?: boolean;
}

function PhaseBadge({
  shapePhase, designApproved, draftReady, schemaMaterialized, spark,
}: PhaseBadgeProps): JSX.Element {
  const labels: Record<string, string> = spark
    ? {
      design: 'Phase 1 — Spark shape',
      schema: 'Ready to build',
      ready: 'Ready to build',
    }
    : {
      design: 'Phase 1 — Design contract',
      schema: schemaMaterialized && draftReady
        ? 'Ready to build'
        : schemaMaterialized
          ? 'Phase 2 — Schema generated'
          : 'Phase 2 — Generate schema',
      ready: 'Ready to build',
    };
  return (
    <span className={`pill shape-phase ${shapePhase}`}>
      {labels[shapePhase] || shapePhase}
    </span>
  );
}

interface DescriptionPanelProps {
  draft: ChallengeDraft | null | undefined;
  shapePhase: ShapePhase;
  designApproved: boolean;
  schemaMaterialized: boolean;
  shapeContractMissing: string[];
  spark?: boolean;
}

function DescriptionPanel({
  draft, shapePhase, designApproved, schemaMaterialized, shapeContractMissing, spark,
}: DescriptionPanelProps): JSX.Element {
  const sparkShape = draft?.sparkShape as {
    meta?: { name?: string; difficulty?: string; tags?: string[]; category?: string; slug?: string };
    kind?: string;
    brief?: { description?: string; problemStatement?: { overview?: string; yourTask?: string } };
    data?: { businessDate?: string; format?: string };
    platform?: { language?: string };
  } | null | undefined;

  if (spark) {
    const description = sparkShape?.brief?.description?.trim() || draft?.description?.trim();
    const missing = shapeContractMissing || [];
    if (!description && !sparkShape) {
      return (
        <div className="draft-preview-empty">
          No Spark shape yet. Describe the lab in chat, or use{' '}
          <strong>Upload shape JSON</strong> under the composer. The Preview
          updates the same way either path.
        </div>
      );
    }
    const meta = sparkShape?.meta || draft?.meta || {};
    return (
      <div className="description-panel">
        {(meta as { name?: string }).name && (
          <h3 className="contract-title">{(meta as { name?: string }).name}</h3>
        )}
        <div className="contract-pills">
          {sparkShape?.kind && <span className="contract-pill">{sparkShape.kind}</span>}
          {(meta as { difficulty?: string }).difficulty && (
            <span className="contract-pill">{(meta as { difficulty?: string }).difficulty}</span>
          )}
          {((meta as { tags?: string[] }).tags || []).slice(0, 6).map((t) => (
            <span key={t} className="contract-pill">{t}</span>
          ))}
        </div>
        {description && (
          <div className="contract-section">
            <h4 className="contract-section-title">Brief</h4>
            <MarkdownProse text={description} className="markdown-prose contract-prose" />
          </div>
        )}
        {sparkShape?.brief?.problemStatement?.overview && (
          <div className="contract-section">
            <h4 className="contract-section-title">Overview</h4>
            <p className="description-body">{sparkShape.brief.problemStatement.overview}</p>
          </div>
        )}
        {missing.length > 0 && shapePhase === 'design' && !designApproved && (
          <p className="contract-footnote warn">Still needed: {missing.join(', ')}</p>
        )}
        {shapePhase === 'design' && !designApproved && missing.length === 0 && description && (
          <p className="contract-footnote">
            Shape looks complete. Click <strong>Approve design</strong> when ready to build.
          </p>
        )}
        {designApproved && (
          <p className="contract-footnote">
            Shape approved — use <strong>Build pipeline</strong> on the right.
          </p>
        )}
        <details className="json-toggle">
          <summary>Full shape JSON</summary>
          <pre>{JSON.stringify(sparkShape || draft, null, 2)}</pre>
        </details>
      </div>
    );
  }

  const description = draft?.description?.trim();
  const rootCause = draft?.brokenState?.rootCause?.trim();
  const meta = draft?.meta || {};
  const catalogueCategories = (meta.catalogueCategories || []).filter((c) => c !== 'global');
  const services = (draft?.infra?.services || []).map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean);
  const symptoms = draft?.brokenState?.validationSymptoms || [];
  const arch = draft?.arch?.trim();
  const metricsGuidance = draft?.metrics?.display?.guidance?.trim();
  const missing = shapeContractMissing || [];

  if (!description) {
    return (
      <div className="draft-preview-empty">
        No design contract yet. Describe the incident in chat; the agent will emit a full
        {' '}<code>&lt;shape_contract&gt;</code> JSON block when ready.
      </div>
    );
  }

  const metaRows = [
    meta.category && { label: 'Primary category', value: meta.category },
    meta.difficulty && { label: 'Difficulty', value: meta.difficulty },
    services.length > 0 && { label: 'Services', value: services.join(', ') },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div className="description-panel">
      {meta.name && <h3 className="contract-title">{meta.name}</h3>}

      {catalogueCategories.length > 0 && (
        <div className="contract-pills">
          <span className="contract-pills-label">Catalogue</span>
          {catalogueCategories.map((cat) => (
            <span key={cat} className="contract-pill">{cat}</span>
          ))}
        </div>
      )}

      {metaRows.length > 0 && (
        <dl className="contract-meta-grid">
          {metaRows.map(({ label, value }) => (
            <div key={label} className="contract-meta-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <section className="contract-section">
        <h4 className="contract-section-title">Description</h4>
        <MarkdownProse text={description} className="description-body markdown-prose" />
      </section>

      {arch && (
        <section className="contract-section">
          <h4 className="contract-section-title">Architecture</h4>
          <p className="contract-prose">{arch}</p>
        </section>
      )}

      {symptoms.length > 0 && (
        <section className="contract-section">
          <h4 className="contract-section-title">Validation intent</h4>
          <ol className="contract-list">
            {symptoms.map((s) => (
              <li key={s.order ?? s.check}>{s.check}</li>
            ))}
          </ol>
        </section>
      )}

      {metricsGuidance && (
        <section className="contract-section">
          <h4 className="contract-section-title">Metrics intent</h4>
          <p className="contract-prose">{metricsGuidance}</p>
        </section>
      )}

      {rootCause && (
        <details className="contract-details setter-only">
          <summary>Root cause (setter-only)</summary>
          <p className="contract-prose">{rootCause}</p>
        </details>
      )}

      {missing.length > 0 && shapePhase === 'design' && !designApproved && (
        <p className="contract-footnote warn">
          Still needed before approve: <strong>{missing.join(', ')}</strong>
        </p>
      )}
      {shapePhase === 'design' && !designApproved && missing.length === 0 && (
        <p className="contract-footnote">
          Design contract complete. Keep chatting to refine, or click <strong>Approve design</strong> when ready.
        </p>
      )}
      {designApproved && !schemaMaterialized && (
        <p className="contract-footnote">
          Design approved. Click <strong>Generate schema</strong> above to materialize services and enable build.
        </p>
      )}
    </div>
  );
}

interface SchemaPreviewProps {
  draft: ChallengeDraft | null | undefined;
  compact?: boolean;
}

function SchemaPreview({ draft, compact = false }: SchemaPreviewProps): JSX.Element {
  if (!draft?.infra?.services?.length) {
    return (
      <div className="draft-preview-empty">
        Schema not generated yet. Approve the description, then run <strong>Generate schema</strong>.
      </div>
    );
  }
  const meta = draft.meta || {};
  const title = meta.name || draft.title || '—';
  const description = (draft.description || meta.description || '').trim();
  const serviceNames = (draft.infra?.services || [])
    .map((s) => (typeof s === 'string' ? s : s.name))
    .filter(Boolean);
  const symptoms = draft.brokenState?.validationSymptoms || [];
  const rootCause = draft.brokenState?.rootCause?.trim();
  const observeCount = draft.metrics?.observe?.length || 0;

  if (compact) {
    return (
      <div className="preview-compact">
        <h4 className="preview-compact-title">{title}</h4>
        {meta.category && (
          <span className="preview-compact-pill">{meta.category}</span>
        )}
        {description ? (
          <section className="preview-compact-section">
            <span className="preview-compact-label">Description</span>
            <MarkdownProse text={description} className="preview-compact-description markdown-prose" />
          </section>
        ) : (
          <p className="preview-compact-stats dim">No description yet.</p>
        )}
        {serviceNames.length > 0 && (
          <div className="preview-compact-section">
            <span className="preview-compact-label">Services</span>
            <ul className="preview-compact-chips">
              {serviceNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="preview-compact-stats dim">
          {symptoms.length} validation step{symptoms.length === 1 ? '' : 's'}
          {observeCount > 0 ? ` · ${observeCount} observable${observeCount === 1 ? '' : 's'}` : ''}
        </p>
        {rootCause && (
          <details className="preview-compact-details">
            <summary>Root cause (setter-only)</summary>
            <p className="preview-compact-prose">{rootCause}</p>
          </details>
        )}
        <details className="preview-compact-details">
          <summary>Validation checklist</summary>
          <DesignValidationChecklist draft={draft} />
        </details>
        <details className="preview-compact-details">
          <summary>Full JSON</summary>
          <pre className="preview-compact-json">{JSON.stringify(draft, null, 2)}</pre>
        </details>
      </div>
    );
  }

  return (
    <div className="draft-preview">
      <div className="row">
        <span className="label">Title</span>
        <span className="value">{title}</span>
      </div>
      <div className="row col">
        <span className="label">Description</span>
        {description ? (
          <MarkdownProse text={description} className="value markdown-prose draft-preview-description" />
        ) : (
          <span className="value">—</span>
        )}
      </div>
      <div className="row">
        <span className="label">Category</span>
        <span className="value">{meta.category || '—'}</span>
      </div>
      <div className="row">
        <span className="label">Services (catalogue)</span>
        <span className="value">{serviceNames.join(', ') || '—'}</span>
      </div>
      <div className="row">
        <span className="label">Observables</span>
        <span className="value">{observeCount || '—'}</span>
      </div>
      <div className="row col">
        <span className="label">Root cause</span>
        <span className="value">{rootCause || '—'}</span>
      </div>
      <DesignValidationChecklist draft={draft} />
      <details className="json-toggle">
        <summary>Full JSON</summary>
        <pre>{JSON.stringify(draft, null, 2)}</pre>
      </details>
    </div>
  );
}

interface ShapePreviewPanelProps {
  draft: ProblemSession | null;
  shapePhase: ShapePhase;
  designApproved: boolean;
  schemaMaterialized: boolean;
  shapeContractMissing: string[];
}

function ShapePreviewPanel({
  draft, shapePhase, designApproved, schemaMaterialized, shapeContractMissing,
}: ShapePreviewPanelProps): JSX.Element {
  const d = draft?.draft;
  const spark = isSparkSession(draft);

  // Spark has no schema agent — always show shape/brief preview
  if (spark) {
    return (
      <DescriptionPanel
        draft={d}
        shapePhase={shapePhase}
        designApproved={designApproved}
        schemaMaterialized={schemaMaterialized}
        shapeContractMissing={shapeContractMissing}
        spark
      />
    );
  }

  if (schemaMaterialized) {
    return <SchemaPreview draft={d} compact />;
  }

  return (
    <DescriptionPanel
      draft={d}
      shapePhase={shapePhase}
      designApproved={designApproved}
      schemaMaterialized={schemaMaterialized}
      shapeContractMissing={shapeContractMissing}
    />
  );
}

type StreamEvent = {
  type: string;
  delta?: string;
  extracted?: Record<string, unknown>;
  message?: string;
  draft?: ChallengeDraft;
  shapePhase?: string;
  draftReady?: boolean;
  [key: string]: unknown;
};

export default function ProblemSetterPage({
  draft,
  llmConfig,
  onGoPipelineLogs,
  onGoBuild,
  onGoPipeline,
  onGoReview,
  onDraftChanged,
  onImportDraft,
  onDeleteDraft: _onDeleteDraft,
  onRefreshSession,
}: ProblemSetterPageProps): JSX.Element {
  const [input, setInput] = useState<string>('');
  const [streamingText, setStreamingText] = useState<string>('');
  const [streamingPending, setStreamingPending] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const shapeFileRef = useRef<HTMLInputElement>(null);

  const shapePhase: ShapePhase = draft?.shapePhase || 'design';
  const designApproved = !!draft?.designApproved;
  const schemaMaterialized = !!draft?.schemaMaterialized;
  const llmReady = !!llmConfig?.llmConfigured;
  const spark = isSparkSession(draft);
  const buildSucceeded = isBuildSucceeded(draft);
  const canChat = shapePhase === 'design' && !designApproved;
  const canUploadShape = spark && !designApproved && !busy;
  const shapeContractComplete = draft?.shapeContractComplete
    ?? (spark
      ? Boolean(draft?.draft?.sparkShape || (draft as { sparkShape?: unknown })?.sparkShape)
      : isShapeContractCompleteLocal(draft?.draft));
  const shapeContractMissing = (draft?.shapeContractMissing?.length
    && draft?.shapeContractComplete === false
    && !(spark ? Boolean(draft?.draft?.sparkShape || (draft as { sparkShape?: unknown })?.sparkShape) : isShapeContractCompleteLocal(draft?.draft)))
    ? draft.shapeContractMissing
    : (spark ? (draft?.shapeContractMissing || []) : shapeContractMissingLocal(draft?.draft));
  // Spark: approve → ready (no schema agent). Compose: need schema materialized.
  const schemaReadyForBuild = spark
    ? !!(designApproved && shapeContractComplete)
    : !!(
      schemaMaterialized
      && (draft?.draftReady || isDraftBuildReadyLocal(draft?.draft))
    );
  const canRevise = spark
    ? designApproved && !buildSucceeded
    : designApproved && !schemaMaterialized;
  // Spark upload path does not need LLM; compose approve still does.
  const canApprove = !designApproved && shapeContractComplete && (spark || llmReady);
  const canGenerateSchema = !spark && designApproved && !schemaMaterialized && llmReady && shapeContractComplete;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 80;
    if (nearBottom || streamingText) {
      el.scrollTop = el.scrollHeight;
    }
  }, [draft?.messages?.length, streamingText]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  if (!draft) {
    return <Empty onImport={onImportDraft} />;
  }

  const send = async (): Promise<void> => {
    if (!input.trim() || busy || !llmReady || !canChat) return;
    const msg = input.trim();
    setInput('');
    setBusy(true);
    setErr(null);
    setStreamingText('');
    setStreamingPending(spark
      ? 'Shaping Spark contract in Preview…'
      : 'Shaping design contract in Preview…');

    const optimistic: ProblemSession = {
      ...draft,
      messages: [...(draft.messages || []), { role: 'user', content: msg }],
    };
    onDraftChanged(optimistic);

    const controller = new AbortController();
    abortRef.current = controller;

    let visibleText = '';
    let partial: ChallengeDraft = optimistic.draft || { authoringKind: spark ? 'spark-platform' : undefined };
    try {
      await streamChat(draft.id, msg, (ev: unknown) => {
        const event = ev as StreamEvent;
        if (event.type === 'text') {
          visibleText += event.delta || '';
          setStreamingText(visibleText);
          setStreamingPending(null);
        } else if (event.type === 'design') {
          const ex = event.extracted || {};
          if (spark || ex.brief || ex.data) {
            partial = {
              ...partial,
              authoringKind: 'spark-platform',
              sparkShape: ex as ChallengeDraft['sparkShape'],
              description: (ex.brief as { description?: string } | undefined)?.description
                || partial.description,
              meta: {
                ...(partial.meta || {}),
                ...((ex.meta as object) || {}),
              },
            };
          } else {
            partial = {
              ...partial,
              description: ex.description as string,
              arch: (ex.arch as string) || partial.arch,
              meta: {
                ...(partial.meta || {}),
                ...(ex.meta as Record<string, unknown> || {}),
                ...((ex.catalogueCategories as string[])?.length
                  ? { catalogueCategories: ex.catalogueCategories as string[] }
                  : {}),
              },
              infra: (ex.infra as { services?: unknown[] })?.services?.length
                ? { ...(partial.infra || {}), services: (ex.infra as { services: Array<string | { name: string }> }).services }
                : partial.infra,
              brokenState: ex.brokenState
                ? { ...(partial.brokenState || {}), ...(ex.brokenState as object) }
                : partial.brokenState,
            };
          }
        } else if (event.type === 'error') {
          setErr(event.message ?? 'Unknown error');
        }
      }, { signal: controller.signal });

      onDraftChanged({
        ...optimistic,
        messages: [...optimistic.messages!, { role: 'assistant', content: visibleText }],
        draft: partial,
        authoringKind: spark ? 'spark-platform' : optimistic.authoringKind,
        shapeContractComplete: spark
          ? Boolean(partial.sparkShape)
          : isShapeContractCompleteLocal(partial),
        shapeContractMissing: spark ? [] : shapeContractMissingLocal(partial),
      });
      if (onRefreshSession) await onRefreshSession();
      setStreamingText('');
      setStreamingPending(null);
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const runGenerateSchema = async (): Promise<void> => {
    setStreamingText('');
    setStreamingPending('Materializing schema — see Preview when ready…');
    const controller = new AbortController();
    abortRef.current = controller;

    let visibleText = '';
    let sessionPatch: ProblemSession = draft;
    await generateSchema(draft.id, (ev: unknown) => {
      const event = ev as StreamEvent;
      if (event.type === 'text') {
        visibleText += event.delta || '';
        setStreamingText(visibleText);
        setStreamingPending(null);
      } else if (event.type === 'error') {
        setErr(event.message ?? 'Unknown error');
      } else if (event.type === 'draft' && onDraftChanged) {
        sessionPatch = {
          ...sessionPatch,
          draft: event.draft ?? sessionPatch.draft,
          schemaMaterialized: true,
        };
        onDraftChanged(sessionPatch);
      } else if (event.type === 'shape' && onDraftChanged) {
        sessionPatch = {
          ...sessionPatch,
          shapePhase: event.shapePhase,
          draftReady: event.draftReady,
          schemaMaterialized: true,
        };
        onDraftChanged(sessionPatch);
      }
    }, { signal: controller.signal });

    if (onRefreshSession) {
      await onRefreshSession();
    }
    setStreamingText('');
    setStreamingPending(null);
  };

  const handleApproveDesign = async (): Promise<void> => {
    if (!canApprove || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await approveDesign(draft.id);
      if (onRefreshSession) await onRefreshSession();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string; missing?: string[] } }; message?: string };
      setErr(err?.response?.data?.error
        || (err?.response?.data?.missing?.length
          ? `${err.response!.data!.error}: ${err.response!.data!.missing.join(', ')}`
          : null)
        || err.message || 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleUploadShapeFile = async (file: File): Promise<void> => {
    if (!canUploadShape || !draft) return;
    setBusy(true);
    setErr(null);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('File is not valid JSON');
      }
      // Allow { contract }, { sparkShape }, or the raw contract object
      const obj = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
      const contract = obj && (obj.contract != null || obj.sparkShape != null)
        ? (obj.contract ?? obj.sparkShape)
        : parsed;
      const res = await uploadSparkShape(draft.id, contract) as {
        draft?: ProblemSession;
        shapeContractComplete?: boolean;
        shapeContractMissing?: string[];
      };
      if (res.draft) {
        onDraftChanged({
          ...res.draft,
          shapeContractComplete: res.shapeContractComplete,
          shapeContractMissing: res.shapeContractMissing,
        } as ProblemSession);
      }
      if (onRefreshSession) await onRefreshSession();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string; hint?: string } }; message?: string };
      setErr(
        [err?.response?.data?.error, err?.response?.data?.hint].filter(Boolean).join(' — ')
        || err.message
        || 'Upload failed',
      );
    } finally {
      setBusy(false);
      if (shapeFileRef.current) shapeFileRef.current.value = '';
    }
  };

  const handleGenerateSchema = async (): Promise<void> => {
    if (!canGenerateSchema || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await runGenerateSchema();
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        setErr(err?.response?.data?.error || err.message || 'Unknown error');
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const handleRevise = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const result = await reviseDesign(draft.id) as { draft?: ChallengeDraft };
      if (onRefreshSession) await onRefreshSession();
      else if (result.draft) onDraftChanged({ ...draft, draft: result.draft });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setErr(err?.response?.data?.error || err.message || 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const inputPlaceholder = !llmReady
    ? 'Set API key in backend/.env'
    : canChat
      ? (spark
        ? 'Describe the Spark lab — data shape, transforms, and what candidates should build…'
        : 'Describe the incident, broken state, and what candidates should fix…')
      : schemaReadyForBuild
        ? (spark
          ? 'Shape ready — click Build pipeline to start'
          : 'Schema ready — click Build pipeline to start')
        : designApproved
          ? (spark
            ? 'Shape approved — click Build pipeline to start'
            : 'Generate schema in Preview to continue')
          : 'Approve design in Preview when the contract is complete';

  return (
    <div className="setter-intent-layout">
      <aside className="setter-intent-preview" aria-label="Design preview">
        <div className="setter-rail-card panel setter-rail-card--preview">
          <div className="setter-rail-card-header setter-rail-card-header--stacked">
            <h3 className="setter-rail-card-title">Preview</h3>
            <div className="setter-preview-actions">
              {canApprove && (
                <button
                  type="button"
                  className="sm"
                  disabled={busy}
                  onClick={handleApproveDesign}
                  title={
                    !llmReady
                      ? 'LLM not configured'
                      : !shapeContractComplete
                        ? `Complete contract first: ${shapeContractMissing.join(', ')}`
                        : spark
                          ? 'Lock the Spark shape and enable the build pipeline'
                          : 'Lock the design contract and move to schema generation'
                  }
                >
                  {busy ? 'Approving…' : 'Approve design'}
                </button>
              )}
              {canGenerateSchema && (
                <button
                  type="button"
                  className="sm"
                  disabled={busy}
                  onClick={handleGenerateSchema}
                  title="Generate catalogue schema and image hints from the approved contract"
                >
                  {busy ? 'Generating schema…' : 'Generate schema'}
                </button>
              )}
              {canRevise && (
                <button
                  type="button"
                  className="ghost sm"
                  disabled={busy}
                  onClick={handleRevise}
                >
                  Edit contract
                </button>
              )}
            </div>
            {!designApproved && !shapeContractComplete && shapeContractMissing.length > 0 && (
              <p className="setter-preview-hint dim">
                Still needed: {shapeContractMissing.join(', ')}
              </p>
            )}
            {canGenerateSchema && (
              <p className="setter-preview-hint dim">
                Design approved — run <strong>Generate schema</strong> to enable build.
              </p>
            )}
            {schemaReadyForBuild && (
              <p className="setter-preview-hint dim">
                {spark
                  ? <>Shape ready — <strong>Build pipeline</strong> starts immediately.</>
                  : <>Schema ready — <strong>Build pipeline</strong> starts immediately.</>}
              </p>
            )}
            {err && <p className="setter-preview-hint alert-inline">{err}</p>}
          </div>
          <div className="setter-rail-card-body">
            <ShapePreviewPanel
              draft={draft}
              shapePhase={shapePhase}
              designApproved={designApproved}
              schemaMaterialized={schemaMaterialized}
              shapeContractMissing={shapeContractMissing}
            />
          </div>
        </div>
      </aside>

      <section className="setter-intent-column panel">
        <div className="chat-scroll" ref={scrollRef}>
          {(draft.messages || []).length === 0 && (
            <div className="chat-intro setter-intent-intro">
              <p className="setter-intent-intro-lead">
                {spark
                  ? 'Describe the Spark platform lab you want candidates to build.'
                  : 'Describe the production incident you want candidates to debug.'}
              </p>
              <p className="dim">
                {spark
                  ? 'Chat with the agent to shape a contract, or upload a spark_shape_contract JSON. Preview updates on the left — Approve unlocks Build (no schema step).'
                  : 'The agent will shape a full design contract — story, services, root cause, and validation intent — when you are ready.'}
              </p>
            </div>
          )}
          {(draft.messages || []).map((m, i) => (
            <ChatBubble key={i} role={m.role} content={m.content} />
          ))}
          {streamingPending && !streamingText && (
            <ChatPendingBubble message={streamingPending} />
          )}
          {streamingText && <ChatBubble role="assistant" content={streamingText} />}
        </div>

        <div className="chat-input setter-intent-input">
          {spark && (
            <div className="setter-shape-upload">
              <input
                ref={shapeFileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadShapeFile(file);
                }}
              />
              <button
                type="button"
                className="ghost sm"
                disabled={!canUploadShape}
                onClick={() => shapeFileRef.current?.click()}
                title={
                  designApproved
                    ? 'Use Edit contract before uploading a new shape'
                    : 'Upload a spark_shape_contract JSON — same Preview / Approve path as chat'
                }
              >
                {busy ? 'Uploading…' : 'Upload shape JSON'}
              </button>
              <span className="dim setter-shape-upload-hint">
                Or chat below — Preview updates either way
              </span>
            </div>
          )}
          <div className="setter-intent-composer">
            <textarea
              placeholder={inputPlaceholder}
              disabled={!llmReady || busy || !canChat}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              aria-keyshortcuts="Meta+Enter Control+Enter"
            />
            <button
              type="button"
              className="setter-intent-send"
              onClick={send}
              disabled={!llmReady || busy || !canChat || !input.trim()}
              aria-label={busy && canChat ? 'Sending' : 'Send message'}
              title="Send (⌘/Ctrl + Enter)"
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 4v8M8 4l3.25 3.25M8 4L4.75 7.25"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <aside className="setter-intent-rail" aria-label="Pipeline history">
        <div className="setter-rail-card panel setter-rail-card--history">
          <div className="setter-rail-card-header setter-rail-card-header--stacked">
            <h3 className="setter-rail-card-title">Pipeline history</h3>
            <div className="setter-preview-actions">
              {buildSucceeded && (spark ? true : onGoReview) && (
                <button
                  type="button"
                  className="primary sm"
                  onClick={spark ? (onGoPipeline || onGoBuild) : onGoReview}
                  title={spark
                    ? 'Open Build to publish this lab to Play'
                    : 'Open Ship to inspect the build and push to your library'}
                >
                  {spark ? 'Publish →' : 'Open review →'}
                </button>
              )}
              {!buildSucceeded && (
                <button
                  type="button"
                  className="sm"
                  disabled={!schemaReadyForBuild || busy}
                  onClick={onGoBuild}
                  title={
                    schemaReadyForBuild
                      ? draft?.buildStatus === 'failed'
                        ? 'Retry the build in repair mode with the last failure'
                        : 'Open Build and start the pipeline'
                      : spark
                        ? 'Approve the Spark shape in Preview first'
                        : 'Generate schema in Preview first'
                  }
                >
                  {draft?.buildStatus === 'failed' ? 'Retry pipeline' : 'Build pipeline'}
                </button>
              )}
            </div>
            <p className="setter-preview-hint dim">
              {buildSucceeded
                ? (spark
                  ? 'Build passed — publish when ready, or open logs to inspect the run.'
                  : 'Build passed — open review to ship to your library.')
                : schemaReadyForBuild
                  ? (spark
                    ? draft?.buildStatus === 'failed'
                      ? 'Last build failed — Retry repairs from that error (same workspace).'
                      : 'Shape ready — Build pipeline starts Data → Code → Eval immediately.'
                    : draft?.buildStatus === 'failed'
                      ? 'Last build failed — Retry repairs in the same workspace.'
                      : 'Schema ready — Build pipeline starts validation in Docker immediately.')
                  : designApproved
                    ? (spark
                      ? 'Approve finished — open Build when ready.'
                      : 'Generate schema in Preview to enable build.')
                    : (spark
                      ? 'Approve the Spark shape before building.'
                      : 'Approve design and generate schema before building.')}
            </p>
          </div>
          <div className="setter-rail-card-body">
            <PipelineHistoryRail draft={draft} onGoPipelineLogs={onGoPipelineLogs} />
          </div>
        </div>
      </aside>
    </div>
  );
}
