'use strict';

const composeManager = require('../sandbox/composeManager');

const DEFAULTS = {
  DIAGNOSTIC_USED: { bonus: 10, penalty: 0 },
  CORRECT_FIX: { bonus: 10, penalty: 0 },
  VERIFIED_FIX: { bonus: 10, penalty: 0 },
  SKIPPED_DIAGNOSIS: { bonus: 0, penalty: 15 },
  SKIPPED_VERIFICATION: { bonus: 0, penalty: 10 },
  WRONG_COMMAND: { bonus: 0, penalty: 5 },
};

function computeScore({ session, events }) {
  const elapsedMs = (session.endTime || Date.now()) - session.startTime;
  const elapsedMinutes = elapsedMs / 60_000;
  const timePenalty = Math.floor(elapsedMinutes * 2);
  const recoveryBonus = session.recovered ? 30 : 0;

  let bonuses = 0;
  let penalties = 0;
  const seen = [];

  for (const ev of events || []) {
    const def = DEFAULTS[ev.type] || { bonus: 0, penalty: 0 };
    const data = ev.data || {};
    const bonus = typeof data.bonus === 'number' ? data.bonus : def.bonus;
    const penalty = typeof data.penalty === 'number' ? data.penalty : def.penalty;
    bonuses += bonus;
    penalties += penalty;
    seen.push({ type: ev.type, bonus, penalty });
  }

  const raw = 100 - timePenalty + recoveryBonus + bonuses - penalties;
  const score = Math.max(0, raw);

  return {
    score,
    breakdown: {
      base: 100,
      timePenalty,
      recoveryBonus,
      bonuses,
      penalties,
      elapsedMs,
      events: seen,
    },
  };
}

async function runHttpStep(step, session) {
  const portKey = `HOST_PORT_${(step.service || '').toUpperCase().replace(/-/g, '_')}`;
  const hostPort = session.portMap ? session.portMap[portKey] : null;
  if (!hostPort) {
    return { passed: false, detail: `no host port mapping for ${step.service} (looked for ${portKey})` };
  }
  const url = `http://localhost:${hostPort}${step.path || '/'}`;
  try {
    const res = await fetch(url, { method: step.method || 'GET' });
    const text = await res.text();
    let ok = res.ok;
    if (step.check) {
      const re = new RegExp(step.check, 's');
      ok = ok && re.test(text);
    }
    return { passed: ok, detail: `HTTP ${res.status} ${url}` };
  } catch (e) {
    return { passed: false, detail: `HTTP ${url} failed: ${e.message}` };
  }
}

async function runExecStep(step, session) {
  if (!session.buildDir) {
    return { passed: false, detail: 'no buildDir for session' };
  }
  try {
    const { stdout, stderr } = await composeManager.exec(
      session.buildDir,
      step.service,
      Array.isArray(step.cmd) ? step.cmd : [String(step.cmd)],
      { portMap: session.portMap || {} },
    );
    const out = `${stdout}\n${stderr}`;
    let ok = true;
    if (step.check) {
      const re = new RegExp(step.check, 's');
      ok = re.test(out);
    }
    return { passed: ok, detail: `exec ${step.service}: ${out.slice(0, 200)}` };
  } catch (e) {
    return { passed: false, detail: `exec ${step.service} failed: ${e.message}` };
  }
}

async function runValidation(session, challenge) {
  const spec = challenge.validationSpec || {};
  const steps = Array.isArray(spec.steps) ? spec.steps : [];

  const stepResults = [];
  const events = [];

  for (const step of steps) {
    let result;
    if (step.type === 'http') {
      result = await runHttpStep(step, session);
    } else if (step.type === 'exec') {
      result = await runExecStep(step, session);
    } else {
      result = { passed: false, detail: `unknown step type: ${step.type}` };
    }
    stepResults.push({ ...step, ...result });
    if (result.passed) {
      events.push({ type: 'VERIFIED_FIX', data: { stepType: step.type, service: step.service } });
    }
  }

  const passed = stepResults.length > 0 && stepResults.every((r) => r.passed);
  const feedback = passed
    ? 'All validation steps passed.'
    : `Failures: ${stepResults.filter((r) => !r.passed).map((r) => r.detail).join('; ') || 'no steps defined'}`;

  return {
    evaluation: { passed, feedback, stepResults },
    events,
  };
}

module.exports = { computeScore, runValidation };
