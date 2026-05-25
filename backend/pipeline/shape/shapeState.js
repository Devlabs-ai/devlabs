'use strict';

const { isDraftReady, normalizeDraft, isV1Draft } = require('../draft/draftSchema');
const {
  applyShapeContractToDraft,
  validateShapeContract,
} = require('./shapeContract');

const SHAPE_PHASES = ['description', 'schema', 'ready'];

function defaultShapeState() {
  return {
    shapePhase: 'description',
    descriptionApproved: false,
    schemaMaterialized: false,
  };
}

function ensureShapeState(session) {
  if (!session.shapePhase) session.shapePhase = 'description';
  if (session.descriptionApproved == null) session.descriptionApproved = false;
  if (session.schemaMaterialized == null) session.schemaMaterialized = false;
  return session;
}

function syncShapePhase(session) {
  ensureShapeState(session);
  const buildReady = session.draft && isV1Draft(session.draft) && isDraftReady(session.draft);

  if (session.schemaMaterialized && buildReady) {
    session.shapePhase = 'ready';
    session.descriptionApproved = true;
  } else if (session.descriptionApproved) {
    session.shapePhase = 'schema';
  } else {
    session.shapePhase = 'description';
  }

  // Heal sessions incorrectly marked ready before Phase 2 completed.
  if (session.shapePhase === 'ready' && !session.schemaMaterialized) {
    session.descriptionApproved = false;
    session.shapePhase = 'description';
  }

  return session.shapePhase;
}

function isShapeContractComplete(session) {
  return validateShapeContract(session?.draft).ok;
}

function canChatDescription(session) {
  syncShapePhase(session);
  return session.shapePhase === 'description' && !session.descriptionApproved;
}

function canGenerateSchema(session) {
  syncShapePhase(session);
  return session.descriptionApproved
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
    descriptionApproved: session.descriptionApproved,
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
    session.descriptionApproved = true;
    session.schemaMaterialized = true;
    session.shapePhase = 'ready';
  }
  return session.draft;
}

/** Merge Phase 1 design contract extraction into partial draft. */
function applyDescriptionExtraction(session, extracted) {
  if (!extracted) return session.draft;
  session.draft = applyShapeContractToDraft(session.draft, extracted);
  if (!session.schemaMaterialized) {
    session.shapePhase = 'description';
    session.descriptionApproved = false;
  }
  return session.draft;
}

function markSchemaMaterialized(session, draft) {
  session.draft = normalizeDraft(draft);
  session.schemaMaterialized = true;
  session.descriptionApproved = true;
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
  canChatDescription,
  canGenerateSchema,
  computeDraftReady,
  publicShapeFields,
  applyDraft,
  applyDescriptionExtraction,
  markSchemaMaterialized,
  hasCatalogueCategories,
  isShapeContractComplete,
  validateShapeContract,
};
