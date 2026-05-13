'use strict';

const express = require('express');

const { requireInterviewer } = require('../auth/middleware');
const reviewStore = require('../problems/reviewStore');
const draftStore = require('../problems/problemDraftStore');
const buildAgent = require('../problems/buildAgentService');
const { promote } = require('../problems/promoteToVerified');

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
    res.json({ review: r });
  } catch (e) { next(e); }
});

router.post('/:sessionId/push', async (req, res, next) => {
  try {
    const review = await reviewStore.get(req.params.sessionId);
    if (!review) return res.status(404).json({ error: 'review not found' });

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
    });

    if (draft.buildDir) {
      await buildAgent.teardownBuild(draft.id, draft.buildDir).catch(() => {});
      draft.buildDir = null;
    }
    draft.buildStatus = null;
    draftStore.set(draft.id, draft);
    await draftStore.persist(draft).catch(() => {});
    await reviewStore.remove(req.params.sessionId);

    res.json({ ok: true, slug: result.slug, verifiedDir: result.verifiedDir, challenge: result.challenge });
  } catch (e) { next(e); }
});

router.delete('/:sessionId', async (req, res, next) => {
  try {
    const draft = draftStore.get(req.params.sessionId);
    if (draft && draft.buildDir) {
      await buildAgent.teardownBuild(draft.id, draft.buildDir).catch(() => {});
      draft.buildDir = null;
      draft.buildStatus = null;
      draftStore.set(draft.id, draft);
      await draftStore.persist(draft).catch(() => {});
    }
    await reviewStore.remove(req.params.sessionId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
