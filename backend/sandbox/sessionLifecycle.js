'use strict';

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const composeManager = require('./composeManager');
const portAllocator = require('./portAllocator');
const sessionStore = require('../db/sessionStore');
const loader = require('../challenges/loader');
const invites = require('../auth/invites');
const { SESSIONS_ROOT } = require('./paths');

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(s);
      fs.symlinkSync(target, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function rmDirSync(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (e) {
    console.warn(`[lifecycle] failed to remove ${p}: ${e.message}`);
  }
}

async function start({ challengeId, candidateToken } = {}) {
  if (!challengeId) {
    const e = new Error('challengeId is required');
    e.status = 400;
    throw e;
  }

  const challenge = loader.getChallenge(challengeId);
  if (!challenge) {
    const e = new Error(`challenge "${challengeId}" not found`);
    e.status = 404;
    throw e;
  }

  if (!challenge.verifiedDir || !fs.existsSync(challenge.verifiedDir)) {
    const e = new Error(
      `challenge "${challengeId}" has no verifiedDir; legacy sandbox path is not enabled in this MVP`,
    );
    e.status = 400;
    throw e;
  }

  let candidateName = null;
  if (candidateToken) {
    const invite = await invites.resolveInvite(candidateToken);
    if (!invite) {
      const e = new Error('invalid candidate token');
      e.status = 401;
      throw e;
    }
    candidateName = invite.name;
  }

  const sessionId = uuidv4();
  const sessionDir = path.join(SESSIONS_ROOT, sessionId);
  fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
  copyDirSync(challenge.verifiedDir, sessionDir);

  const { content: composeYaml } = composeManager.readComposeFile(sessionDir);
  const portMap = await composeManager.resolvePortMap(sessionDir, composeYaml, sessionId);
  const services = composeManager.extractServiceNames(composeYaml);

  const session = sessionStore.makeSession({
    id: sessionId,
    challengeId,
    candidateName,
    status: 'active',
  });
  session.buildDir = sessionDir;
  session.portMap = portMap;
  session.services = services;
  session.metricsService = challenge.validationSpec?.metricsService || null;
  session.terminalService = challenge.validationSpec?.terminalService || (services[0] || null);
  sessionStore.set(sessionId, session);

  await sessionStore.persistRow(session);

  try {
    await composeManager.up(sessionDir, portMap);
    await composeManager.waitForServices(sessionDir, portMap, 90_000);
  } catch (e) {
    console.error(`[lifecycle] startup failed for ${sessionId}: ${e.message}`);
    await composeManager.down(sessionDir);
    await portAllocator.release(sessionId);
    rmDirSync(sessionDir);
    session.status = 'ended';
    session.endTime = Date.now();
    sessionStore.set(sessionId, session);
    await sessionStore.persistRow(session);
    const err = new Error(`failed to start sandbox: ${e.message}`);
    err.status = 500;
    throw err;
  }

  if (candidateToken) {
    try {
      await invites.markUsed(candidateToken);
    } catch (e) {
      console.warn(`[lifecycle] failed to mark invite used: ${e.message}`);
    }
  }

  await sessionStore.persistRuntime(session);

  return { session, challenge };
}

async function end(sessionId) {
  const session = sessionStore.get(sessionId);
  if (!session) {
    const e = new Error(`session "${sessionId}" not found`);
    e.status = 404;
    throw e;
  }

  if (session.status === 'ended') {
    return session;
  }

  if (session.buildDir) {
    try {
      await composeManager.down(session.buildDir);
    } catch (e) {
      console.warn(`[lifecycle] compose down failed: ${e.message}`);
    }
    rmDirSync(session.buildDir);
  }

  try {
    await portAllocator.release(sessionId);
  } catch (e) {
    console.warn(`[lifecycle] port release failed: ${e.message}`);
  }

  session.status = 'ended';
  session.endTime = Date.now();
  sessionStore.set(sessionId, session);

  await sessionStore.persistRow(session);

  return session;
}

module.exports = { start, end };
