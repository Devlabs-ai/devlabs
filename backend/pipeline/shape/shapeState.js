'use strict';

const { isDraftReady, normalizeDraft, isV1Draft } = require('../draft/draftSchema');
const {
  applyShapeContractToDraft,
  validateShapeContract,
} = require('./shapeContract');

// Phase machine for a draft session:
//   design  — Phase 1 (designAgent owns the chat; shape contract being shaped)
//   schema  — Phase 2 (schemaAgent materializes the v1 challenge JSON)
//   ready   — schema generated, draft is build-ready
const SHAPE_PHASES = ['design', 'schema', 'ready'];

function defaultShapeState() {
  return {
    shapePhase: 'design',
    designApproved: false,
    schemaMaterialized: false,
  };
}

function ensureShapeState(session) {
  if (!session.shapePhase) session.shapePhase = 'design';
  if (session.designApproved == null) session.designApproved = false;
  if (session.schemaMaterialized == null) session.schemaMaterialized = false;
  return session;
}

function syncShapePhase(session) {
  ensureShapeState(session);
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

  return session.shapePhase;
}

function isShapeContractComplete(session) {
  return validateShapeContract(session?.draft).ok;
}

function canChatDesign(session) {
  syncShapePhase(session);
  return session.shapePhase === 'design' && !session.designApproved;
}

function canGenerateSchema(session) {
  syncShapePhase(session);
  return session.designApproved
    && session.shapePhase === 'schema'
    && !session.schemaMaterialized
    && isShapeContractComplete(session);
}

function computeDraftReady(session) {
  if (!session?.draft) return false;
  return isDraftReady(session.draft);
}

function publicShapeFields(session) {
  syncShapePhase(session);
  const validation = validateShapeContract(session?.draft);
  return {
    shapePhase: session.shapePhase,
    designApproved: session.designApproved,
    schemaMaterialized: !!session.schemaMaterialized,
    draftReady: computeDraftReady(session),
    shapeContractComplete: validation.ok,
    shapeContractMissing: validation.missing,
  };
}

/** Apply imported or generated full draft and mark ready when valid. */
function applyDraft(session, draft) {
  session.draft = normalizeDraft(draft);
  if (isDraftReady(session.draft)) {
    session.designApproved = true;
    session.schemaMaterialized = true;
    session.shapePhase = 'ready';
  }
  return session.draft;
}

/** Merge Phase 1 design contract extraction into partial draft. */
function applyDesignExtraction(session, extracted) {
  if (!extracted) return session.draft;
  session.draft = applyShapeContractToDraft(session.draft, extracted);
  if (!session.schemaMaterialized) {
    session.shapePhase = 'design';
    session.designApproved = false;
  }
  return session.draft;
}

function markSchemaMaterialized(session, draft) {
  session.draft = normalizeDraft(draft);
  session.schemaMaterialized = true;
  session.designApproved = true;
  session.shapePhase = isDraftReady(session.draft) ? 'ready' : 'schema';
  return session;
}

function hasCatalogueCategories(session) {
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
};
