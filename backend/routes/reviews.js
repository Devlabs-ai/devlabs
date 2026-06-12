'use strict';

const express = require('express');

const { requireInterviewer } = require('../auth/middleware');
const reviewStore = require('../pipeline/stores/reviewStore');
const draftStore = require('../pipeline/stores/problemDraftStore');
const buildPipeline = require('../pipeline/pipelines/buildPipeline');
const { promote } = require('../pipeline/promoteToVerified');
const { normalizeBucket } = require('../challenges/buckets');
const lifecycle = require('../sandbox/sessionLifecycle');
const sessionStore = require('../db/sessionStore');

const PORT = parseInt(process.env.PORT || '4000', 10);
const BACKEND_HOST = `localhost:${PORT}`;

const activePreviews = new Map();

function previewWsUrls(sessionId) {
  return {
    terminalWsUrl: `ws://${BACKEND_HOST}/ws/terminal?sessionId=${sessionId}`,
    metricsWsUrl: `ws://${BACKEND_HOST}/ws/metrics?sessionId=${sessionId}`,
  };
}

function publicPreviewSession(session, challenge) {
  const services = (session.services || []).filter((s) => !/^load[-_]?gen/i.test(s));
  return {
    id: session.id,
    status: session.status,
    startTime: session.startTime,
    services: services.length ? services : session.services,
    portMap: session.portMap,
    metricsService: session.metricsService,
    terminalService: session.terminalService,
    challenge,
  };
}

async function endPreviewForReview(reviewSessionId) {
  const playId = activePreviews.get(reviewSessionId);
  if (!playId) return;
  activePreviews.delete(reviewSessionId);
  try {
    await lifecycle.end(playId);
  } catch (_e) { /* noop */ }
  sessionStore.remove(playId);
}

const router = express.Router();
router.use(requireInterviewer);

router.get('/', async (_req, res, next) => {
  try {
    const reviews = await reviewStore.list();
    res.json({ reviews });
  } catch (e) { next(e); }
});

router.get('/:sessionId', async (req, res, next) => {
  try {
    const r = await reviewStore.get(req.params.sessionId);
    if (!r) return res.status(404).json({ error: 'review not found' });
    res.json({
      review: r,
      previewSessionId: activePreviews.get(req.params.sessionId) || null,
    });
  } catch (e) { next(e); }
});

router.post('/:sessionId/preview', async (req, res, next) => {
  try {
    const review = await reviewStore.get(req.params.sessionId);
    if (!review) return res.status(404).json({ error: 'review not found' });
    if (!review.buildDir) {
      return res.status(400).json({ error: 'review has no build directory' });
    }

    await endPreviewForReview(req.params.sessionId);

    const { session, challenge } = await lifecycle.startPreview({
      buildDir: review.buildDir,
      builtChallenge: review.builtChallenge,
      reviewSessionId: req.params.sessionId,
    });

    activePreviews.set(req.params.sessionId, session.id);
    const ws = previewWsUrls(session.id);
    res.status(201).json({
      sessionId: session.id,
      ...ws,
      services: session.services,
      terminalService: session.terminalService,
      portMap: session.portMap,
      challenge,
      session: publicPreviewSession(session, challenge),
    });
  } catch (e) { next(e); }
});

router.post('/:sessionId/preview/end', async (req, res, next) => {
  try {
    const review = await reviewStore.get(req.params.sessionId);
    if (!review) return res.status(404).json({ error: 'review not found' });
    await endPreviewForReview(req.params.sessionId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:sessionId/push', async (req, res, next) => {
  try {
    const review = await reviewStore.get(req.params.sessionId);
    if (!review) return res.status(404).json({ error: 'review not found' });

    const requestedBucket = req.body?.bucket
      || review.builtChallenge?.bucket
      || review.builtChallenge?.meta?.bucket;
    if (!requestedBucket) {
      return res.status(400).json({ error: 'bucket is required to push a review' });
    }
    const bucket = normalizeBucket(requestedBucket);
    if (!bucket) {
      return res.status(400).json({ error: `unknown bucket: ${requestedBucket}` });
    }

    let draft = draftStore.get(req.params.sessionId);
    if (!draft) {
      draft = draftStore.makeDraft({ id: req.params.sessionId });
      draft.buildDir = review.buildDir;
      draft.builtChallenge = review.builtChallenge;
      draft.buildValidation = review.buildValidation;
      draftStore.set(draft.id, draft);
    }

    const result = await promote({
      buildDir: draft.buildDir,
      builtChallenge: draft.builtChallenge,
      fallbackTitle: review.title || draft.id,
      bucket,
      authoredBy: req.user?.sub || null,
    });

    await endPreviewForReview(req.params.sessionId);

    if (draft.buildDir) {
      await buildPipeline.teardownBuild(draft.id, draft.buildDir).catch(() => {});
    }
    await draftStore.remove(draft.id);
    await reviewStore.remove(req.params.sessionId);

    res.json({ ok: true, slug: result.slug, verifiedDir: result.verifiedDir, challenge: result.challenge });
  } catch (e) { next(e); }
});

router.delete('/:sessionId', async (req, res, next) => {
  try {
    await endPreviewForReview(req.params.sessionId);
    const draft = draftStore.get(req.params.sessionId);
    if (draft && draft.buildDir) {
      await buildPipeline.teardownBuild(draft.id, draft.buildDir).catch(() => {});
      draft.buildDir = null;
      draft.buildStatus = null;
      draftStore.set(draft.id, draft);
      await draftStore.persist(draft).catch(() => {});
    }
    await reviewStore.remove(req.params.sessionId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

const REVIEW_FEEDBACK_TAGS = new Set([
  'url-routing',
  'metrics-grafana',
  'candidate-brief',
  'compose-infra',
  'validation-gap',
  'other',
]);

function normalizeFeedbackTags(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(
    raw
      .map((t) => String(t || '').trim().toLowerCase())
      .filter((t) => REVIEW_FEEDBACK_TAGS.has(t)),
  )];
}

async function ensureDraftFromReview(review, sessionId) {
  let draft = draftStore.get(sessionId);
  if (!draft) {
    draft = draftStore.makeDraft({ id: sessionId });
    draft.buildDir = review.buildDir;
    draft.builtChallenge = review.builtChallenge;
    draft.buildValidation = review.buildValidation;
    draftStore.set(draft.id, draft);
  }
  return draft;
}

router.post('/:sessionId/send-back', async (req, res, next) => {
  try {
    const sessionId = req.params.sessionId;
    const review = await reviewStore.get(sessionId);
    if (!review) return res.status(404).json({ error: 'review not found' });

    const observations = String(req.body?.observations || '').trim();
    if (!observations) {
      return res.status(400).json({ error: 'Observations are required' });
    }

    const severity = req.body?.severity === 'suggestion' ? 'suggestion' : 'blocker';
    const tags = normalizeFeedbackTags(req.body?.tags);

    const draft = await ensureDraftFromReview(review, sessionId);
    draft.reviewFeedback = {
      observations,
      tags,
      severity,
      submittedAt: Date.now(),
      submittedBy: req.user?.sub || null,
    };
    draft.buildStatus = 'changes_requested';
    draft.buildDir = review.buildDir || draft.buildDir;
    draft.builtChallenge = review.builtChallenge || draft.builtChallenge;
    draft.buildValidation = review.buildValidation || draft.buildValidation;
    draftStore.set(draft.id, draft);
    await draftStore.persist(draft);

    await endPreviewForReview(sessionId);
    await reviewStore.remove(sessionId);

    res.json({ ok: true, draftId: draft.id });
  } catch (e) { next(e); }
});

module.exports = router;
