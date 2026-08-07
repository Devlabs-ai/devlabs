'use strict';

import type { ChallengeDraft, DraftSession } from '../../types/domain';

const { isDraftReady, normalizeDraft, isV1Draft } = require('../draft/draftSchema');
const {
  applyShapeContractToDraft,
  validateShapeContract,
} = require('./shapeContract');
const {
  validateSparkShapeContract,
  normalizeSparkShapeContract,
} = require('../spark/shapeContract');

// Phase machine for a draft session:
//   design  — Phase 1 (designAgent owns the chat; shape contract being shaped)
//   schema  — Phase 2 (schemaAgent materializes the v1 challenge JSON) — compose only
//   ready   — schema generated (compose) or shape approved (spark), draft is build-ready
const SHAPE_PHASES = ['design', 'schema', 'ready'];

function isSparkAuthoring(session: Partial<DraftSession> | null | undefined): boolean {
  const draft = session?.draft as { authoringKind?: string } | null | undefined;
  return draft?.authoringKind === 'spark-platform';
}

function sparkShapeMissing(session: Partial<DraftSession>): string[] {
  const draft = session?.draft as { sparkShape?: unknown } | null | undefined;
  const normalized = normalizeSparkShapeContract(draft?.sparkShape);
  return validateSparkShapeContract(normalized);
}

function defaultShapeState(): Pick<DraftSession, 'shapePhase' | 'designApproved' | 'schemaMaterialized'> {
  return {
    shapePhase: 'design',
    designApproved: false,
    schemaMaterialized: false,
  };
}

function ensureShapeState(session: Partial<DraftSession>): Partial<DraftSession> {
  if (!session.shapePhase) session.shapePhase = 'design';
  if (session.designApproved == null) session.designApproved = false;
  if (session.schemaMaterialized == null) session.schemaMaterialized = false;
  return session;
}

function syncShapePhase(session: Partial<DraftSession>): string {
  ensureShapeState(session);

  // Spark: approve design → ready (no schema agent)
  if (isSparkAuthoring(session)) {
    if (session.designApproved) {
      session.shapePhase = 'ready';
      session.schemaMaterialized = true;
    } else {
      session.shapePhase = 'design';
      session.schemaMaterialized = false;
    }
    return session.shapePhase!;
  }

  const buildReady = session.draft && isV1Draft(session.draft) && isDraftReady(session.draft);

  if (session.schemaMaterialized && buildReady) {
    session.shapePhase = 'ready';
    session.designApproved = true;
  } else if (session.designApproved) {
    session.shapePhase = 'schema';
  } else {
    session.shapePhase = 'design';
  }

  // Heal sessions incorrectly marked ready before Phase 2 completed.
  if (session.shapePhase === 'ready' && !session.schemaMaterialized) {
    session.designApproved = false;
    session.shapePhase = 'design';
  }

  return session.shapePhase!;
}

function isShapeContractComplete(session: Partial<DraftSession>): boolean {
  if (isSparkAuthoring(session)) {
    return sparkShapeMissing(session).length === 0;
  }
  return validateShapeContract(session?.draft).ok;
}

function canChatDesign(session: Partial<DraftSession>): boolean {
  syncShapePhase(session);
  return session.shapePhase === 'design' && !session.designApproved;
}

function canGenerateSchema(session: Partial<DraftSession>): boolean {
  if (isSparkAuthoring(session)) return false;
  syncShapePhase(session);
  return !!session.designApproved
    && session.shapePhase === 'schema'
    && !session.schemaMaterialized
    && isShapeContractComplete(session);
}

function computeDraftReady(session: Partial<DraftSession>): boolean {
  if (!session?.draft) return false;
  if (isSparkAuthoring(session)) {
    return !!session.designApproved && sparkShapeMissing(session).length === 0;
  }
  return isDraftReady(session.draft);
}

function publicShapeFields(session: Partial<DraftSession>): {
  shapePhase: string;
  designApproved: boolean;
  schemaMaterialized: boolean;
  draftReady: boolean;
  shapeContractComplete: boolean;
  shapeContractMissing: string[];
  authoringKind: string | null;
} {
  syncShapePhase(session);
  const spark = isSparkAuthoring(session);
  const missing = spark ? sparkShapeMissing(session) : validateShapeContract(session?.draft).missing;
  const ok = spark ? missing.length === 0 : validateShapeContract(session?.draft).ok;
  return {
    shapePhase: session.shapePhase!,
    designApproved: !!session.designApproved,
    schemaMaterialized: !!session.schemaMaterialized,
    draftReady: computeDraftReady(session),
    shapeContractComplete: ok,
    shapeContractMissing: missing,
    authoringKind: spark ? 'spark-platform' : null,
  };
}

/** Apply imported or generated full draft and mark ready when valid. */
function applyDraft(session: Partial<DraftSession>, draft: ChallengeDraft): ChallengeDraft {
  if ((draft as { authoringKind?: string }).authoringKind === 'spark-platform'
    || (draft as { sparkShape?: unknown }).sparkShape) {
    const sparkDraft = {
      ...draft,
      authoringKind: 'spark-platform' as const,
    };
    session.draft = sparkDraft as ChallengeDraft;
    const missing = validateSparkShapeContract(
      (sparkDraft as { sparkShape?: unknown }).sparkShape as never,
    );
    if (missing.length === 0) {
      session.designApproved = true;
      session.schemaMaterialized = true;
      session.shapePhase = 'ready';
    } else {
      session.designApproved = false;
      session.schemaMaterialized = false;
      session.shapePhase = 'design';
    }
    return session.draft as ChallengeDraft;
  }

  const normalized = normalizeDraft(draft);
  session.draft = normalized;
  if (isDraftReady(normalized)) {
    session.designApproved = true;
    session.schemaMaterialized = true;
    session.shapePhase = 'ready';
  }
  return normalized;
}

/** Merge Phase 1 design contract extraction into partial draft. */
function applyDesignExtraction(
  session: Partial<DraftSession>,
  extracted: Record<string, unknown> | null,
): ChallengeDraft | null {
  if (!extracted) return session.draft || null;

  const looksLikeSpark = isSparkAuthoring(session)
    || (extracted.brief != null && extracted.data != null)
    || extracted.kind === 'implementation'
    || extracted.kind === 'debug';

  if (looksLikeSpark) {
    const prev = (session.draft && typeof session.draft === 'object' ? session.draft : {}) as Record<string, unknown>;
    const sparkShape = extracted;
    const metaFromShape = sparkShape.meta as { name?: string } | undefined;
    session.draft = {
      ...prev,
      authoringKind: 'spark-platform',
      sparkShape,
      meta: {
        ...((prev.meta as object) || {}),
        name: metaFromShape?.name || (prev.meta as { name?: string } | undefined)?.name,
      },
      description: (sparkShape.brief as { description?: string } | undefined)?.description
        || (prev.description as string | undefined)
        || '',
    } as ChallengeDraft;
    if (!session.schemaMaterialized) {
      session.shapePhase = 'design';
      session.designApproved = false;
    }
    return session.draft;
  }

  session.draft = applyShapeContractToDraft(session.draft, extracted);
  if (!session.schemaMaterialized) {
    session.shapePhase = 'design';
    session.designApproved = false;
  }
  return session.draft ?? null;
}

function markSchemaMaterialized(session: Partial<DraftSession>, draft: ChallengeDraft): Partial<DraftSession> {
  session.draft = normalizeDraft(draft);
  session.schemaMaterialized = true;
  session.designApproved = true;
  session.shapePhase = isDraftReady(session.draft) ? 'ready' : 'schema';
  return session;
}

function hasCatalogueCategories(session: Partial<DraftSession>): boolean {
  const cats = session?.draft?.meta?.catalogueCategories;
  return Array.isArray(cats) && cats.filter((c) => c !== 'global').length > 0;
}

module.exports = {
  SHAPE_PHASES,
  defaultShapeState,
  ensureShapeState,
  syncShapePhase,
  canChatDesign,
  canGenerateSchema,
  computeDraftReady,
  publicShapeFields,
  applyDraft,
  applyDesignExtraction,
  markSchemaMaterialized,
  hasCatalogueCategories,
  isShapeContractComplete,
  validateShapeContract,
  isSparkAuthoring,
  sparkShapeMissing,
};
