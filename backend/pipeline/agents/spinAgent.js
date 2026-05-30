'use strict';

// Spin Agent — SPIN step of the build pipeline.
//
// Owns everything between WRITE and VALIDATE:
//   1. Resolve host-port map from the compose file
//   2. docker compose up (background, detached)
//   3. waitForServices — polls until all containers are stable-running
//   4. On failure: strip docker noise, emit structured logs, tear down, release ports
//
// No LLM is called here today, but the module boundary makes it easy to add
// intelligent retry heuristics (e.g. image-tag suggestions) later.
//
// Returns  { portMap }  on success.
// Throws a SpinError (with .composeStdout / .composeStderr / .logs) on failure
// so the pipeline can stash it as spinFailureMsg for the next code-agent call.

const composeManager = require('../../sandbox/composeManager');
const portAllocator = require('../../sandbox/portAllocator');
const { emitLog } = require('../build/buildLogger');

function cap(s, max) {
  if (!s) return s;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated ${str.length - max} chars]`;
}

// Pull whatever logs we can after a failed `docker compose up` / wait.
async function captureComposeLogs(buildDir, portMap) {
  try {
    const { stdout, stderr } = await composeManager.runCompose(
      ['logs', '--no-color', '--tail=200'],
      {
        cwd: buildDir,
        env: portMap
          ? Object.fromEntries(Object.entries(portMap).map(([k, v]) => [k, String(v)]))
          : {},
      },
    );
    return [stdout, stderr].filter(Boolean).join('\n');
  } catch (e) {
    return [e.stdout, e.stderr, e.message].filter(Boolean).join('\n');
  }
}

class SpinError extends Error {
  constructor(message, { composeStdout, composeStderr, logs } = {}) {
    super(message);
    this.name = 'SpinError';
    this.composeStdout = composeStdout || null;
    this.composeStderr = composeStderr || null;
    this.logs = logs || null;
  }
}

/**
 * Run the SPIN phase for one build iteration.
 *
 * @param {object}   opts
 * @param {string}   opts.buildDir        — absolute path to the build artefact directory
 * @param {string}   opts.buildSessionId  — UUID used for port-pool keying
 * @param {function} opts.onEvent         — SSE-style event emitter (same as buildPipeline)
 * @param {string[]} [opts.readyServices] — names of infra services that must reach "running"
 *                                          state before SPIN is considered done. When provided,
 *                                          one-shot and crash-looping worker services are
 *                                          ignored entirely by the readiness gate.
 * @returns {{ portMap: object }}         — resolved host-port environment map
 * @throws {SpinError}                    — structured failure; pipeline stashes as spinFailureMsg
 */
async function spin({ buildDir, buildSessionId, onEvent, readyServices = null }) {
  let portMap;

  try {
    const { content: composeYaml } = composeManager.readComposeFile(buildDir);
    portMap = await composeManager.resolvePortMap(
      buildDir, composeYaml, buildSessionId, { pool: 'build' },
    );
    emitLog(onEvent, {
      level: 'info',
      tag: 'spin',
      message: 'Allocated host ports',
      detail: portMap,
    });

    if (readyServices && readyServices.length > 0) {
      emitLog(onEvent, {
        level: 'info',
        tag: 'spin',
        message: `Gating on ${readyServices.length} ready service(s): ${readyServices.join(', ')}`,
      });
    }
    emitLog(onEvent, { level: 'info', tag: 'spin', message: 'Running docker compose up…' });
    await composeManager.up(buildDir, portMap);

    await composeManager.waitForServices(buildDir, portMap, 90_000, readyServices);
    emitLog(onEvent, { level: 'ok', tag: 'spin', message: 'All services reported running' });

    return { portMap };
  } catch (e) {
    // Strip docker pull-progress noise BEFORE logging or stashing for retry.
    // A single failed Kafka pull can dump 250 KB of "Downloading [==>]" lines
    // into the retry context and blow the LLM's token-per-minute budget.
    const cleanMsg = composeManager.stripDockerNoise(e.message || '');
    const cleanStderr = composeManager.stripDockerNoise(e.stderr || '');
    const cleanStdout = composeManager.stripDockerNoise(e.stdout || '');

    emitLog(onEvent, {
      level: 'error',
      tag: 'spin',
      message: 'Compose spin failed',
      detail: cap(cleanMsg, 1500),
    });

    if (cleanStderr) {
      emitLog(onEvent, {
        level: 'detail',
        tag: 'spin',
        message: 'Compose stderr',
        detail: cap(cleanStderr, 1500),
      });
    }

    const rawLogs = await captureComposeLogs(buildDir, portMap).catch(() => null);
    const logs = rawLogs ? composeManager.stripDockerNoise(rawLogs) : null;
    if (logs) {
      const head = logs.split('\n').slice(0, 40).join('\n');
      emitLog(onEvent, {
        level: 'detail',
        tag: 'spin',
        message: `Container logs (${logs.length} bytes captured)`,
        detail: head,
      });
    }

    // Tear down and release ports before surfacing the error.
    await composeManager.down(buildDir).catch(() => {});
    await portAllocator.releaseIn('build', buildSessionId).catch(() => {});

    throw new SpinError(cleanMsg || e.message, {
      composeStdout: cleanStdout || null,
      composeStderr: cleanStderr || null,
      logs,
    });
  }
}

module.exports = { spin, SpinError };
