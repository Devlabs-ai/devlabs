'use strict';

const express = require('express');
const { requireSessionAccess } = require('../auth/middleware');
const lifecycle = require('../sandbox/sessionLifecycle');
const sessionStore = require('../db/sessionStore');
const loader = require('../challenges/loader');
const scoringEngine = require('../scoring/scoringEngine');
const terminalEventBus = require('../observability/terminalEventBus');

const router = express.Router();

const PORT = parseInt(process.env.PORT || '4000', 10);
const BACKEND_HOST = `localhost:${PORT}`;

function publicSession(s, challenge) {
  return {
    id: s.id,
    status: s.status,
    challengeId: s.challengeId,
    candidateName: s.candidateName,
    startTime: s.startTime,
    endTime: s.endTime,
    score: s.score,
    recovered: s.recovered,
    services: Array.isArray(s.services) && s.services.length > 0
      ? s.services
      : Object.keys(s.portMap || {}),
    portMap: s.portMap,
    metricsService: s.metricsService,
    terminalService: s.terminalService,
    challenge: challenge
      ? {
          id: challenge.id,
          title: challenge.title,
          description: challenge.description,
          difficulty: challenge.difficulty,
          tags: challenge.tags,
          category: challenge.category,
          problemStatement: challenge.problemStatement,
        }
      : null,
  };
}

router.post('/start', requireSessionAccess, async (req, res, next) => {
  try {
    const { challengeId, candidateToken } = req.body || {};
    const { session, challenge } = await lifecycle.start({ challengeId, candidateToken });

    const pub = publicSession(session, challenge);
    res.status(201).json({
      sessionId: session.id,
      status: session.status,
      terminalWsUrl: `ws://${BACKEND_HOST}/ws/terminal?sessionId=${session.id}`,
      metricsWsUrl: `ws://${BACKEND_HOST}/ws/metrics?sessionId=${session.id}`,
      agentObserverWsUrl: `ws://${BACKEND_HOST}/ws/agent-observer?sessionId=${session.id}`,
      services: pub.services,
      terminalService: pub.terminalService,
      challenge: pub.challenge,
      session: pub,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', (req, res) => {
  const session = sessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const challenge = session.challengeId ? loader.getChallenge(session.challengeId) : null;
  res.json({ session: publicSession(session, challenge) });
});

router.post('/:id/end', async (req, res, next) => {
  try {
    const sessionId = req.params.id;
    const before = sessionStore.get(sessionId);
    if (!before) return res.status(404).json({ error: 'session not found' });

    const challenge = before.challengeId ? loader.getChallenge(before.challengeId) : null;

    let evaluation = { passed: false, feedback: 'no validation spec' };
    let validationEvents = [];
    if (challenge && challenge.validationSpec) {
      const result = await scoringEngine.runValidation(before, challenge);
      evaluation = result.evaluation;
      validationEvents = result.events;
    }

    for (const ev of validationEvents) {
      await sessionStore.persistEvent(sessionId, ev.type, ev.data || null);
    }

    const session = await lifecycle.end(sessionId);

    const events = await sessionStore.loadEvents(sessionId);
    const { score, breakdown } = scoringEngine.computeScore({
      session,
      events,
    });
    session.score = score;
    sessionStore.set(sessionId, session);
    await sessionStore.persistRow(session);

    terminalEventBus.emit('session_end', { sessionId, evaluation });

    res.json({
      sessionId,
      score,
      elapsed: (session.endTime || Date.now()) - session.startTime,
      events,
      evaluation,
      breakdown,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
