'use strict';

const { spawn } = require('child_process');
const composeManager = require('../../sandbox/composeManager');
const { resolveObservables } = require('../catalogue/resolveObservables');
const { runAlgorithm } = require('./metricsAnalyzers');

const DEFAULT_WARMUP_SEC = 30;
const DEFAULT_WINDOW_SEC = 120;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse `METRIC key=value key=value` lines into sample objects. */
function parseMetricLine(line) {
  const idx = line.indexOf('METRIC');
  if (idx === -1) return null;
  const tail = line.slice(idx + 6).trim();
  const sample = { ts: Date.now() };
  for (const token of tail.split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq <= 0) continue;
    const key = token.slice(0, eq);
    const val = parseFloat(token.slice(eq + 1));
    if (Number.isFinite(val)) sample[key] = val;
  }
  return Object.keys(sample).length > 1 ? sample : null;
}

function envWithPorts(portMap) {
  const out = {};
  for (const [k, v] of Object.entries(portMap || {})) {
    out[k] = String(v);
  }
  return out;
}

async function fetchServiceLogs(buildDir, service, portMap, sinceSeconds) {
  const args = ['compose', 'logs', '--no-color', `--since=${sinceSeconds}s`, service];
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: buildDir,
      env: { ...process.env, ...envWithPorts(portMap) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || stdout || stderr) {
        resolve(`${stdout}\n${stderr}`);
      } else {
        reject(new Error(`docker compose logs failed (exit ${code}): ${stderr.trim()}`));
      }
    });
  });
}

function samplesFromLogs(logText) {
  const samples = [];
  for (const line of logText.split('\n')) {
    const s = parseMetricLine(line.trim());
    if (s) samples.push(s);
  }
  return samples;
}

/**
 * OBSERVE phase: collect METRIC samples from a running build stack and compute
 * catalogue-driven observables into metrics.observed.
 */
async function runObserve({
  buildDir,
  portMap,
  draft,
  warmupSeconds = DEFAULT_WARMUP_SEC,
  windowSeconds = DEFAULT_WINDOW_SEC,
  onLog,
}) {
  const log = (msg) => { if (onLog) onLog(msg); };
  const resolved = resolveObservables(draft);

  if (!resolved.enabled) {
    log('[observe] skipped — metrics disabled or no matching observables for infra');
    return { observed: null, resolved };
  }

  const service = resolved.service;
  if (!service) {
    log('[observe] skipped — no metrics.service');
    return { observed: null, resolved };
  }

  log(`[observe] warming up ${warmupSeconds}s, then collecting ~${windowSeconds}s from ${service}`);
  log(`[observe] catalogue: ${resolved.observe.length} observable(s) for roles [${resolved.resolvedFrom.roles.join(', ')}]`);

  await sleep(warmupSeconds * 1000);

  let logText = '';
  try {
    logText = await fetchServiceLogs(buildDir, service, portMap, windowSeconds + 15);
  } catch (e) {
    log(`[observe] log fetch failed: ${e.message}`);
    return {
      observed: {
        capturedAt: new Date().toISOString(),
        windowSeconds,
        warmupSeconds,
        service,
        sampleCount: 0,
        warning: e.message,
        values: {},
      },
      resolved,
    };
  }

  const samples = samplesFromLogs(logText);
  log(`[observe] parsed ${samples.length} METRIC sample(s)`);

  if (samples.length < 5) {
    log('[observe] warning: very few samples — load-generator may not be emitting METRIC lines');
  }

  const intervalSeconds = draft.metrics?.interval_seconds || 1;
  const values = {};

  for (const obs of resolved.observe) {
    const result = runAlgorithm(obs.algorithm, samples, obs.field, {
      segment: obs.segment,
      intervalSeconds,
    });
    values[obs.id] = {
      ...result,
      field: obs.field,
      algorithm: obs.algorithm,
    };
    if (result.value != null) {
      log(`[observe]   ${obs.id} = ${result.value} (n=${result.sampleCount})`);
    } else {
      log(`[observe]   ${obs.id} = (no data)`);
    }
  }

  const observed = {
    capturedAt: new Date().toISOString(),
    windowSeconds,
    warmupSeconds,
    service,
    format: resolved.format,
    sampleCount: samples.length,
    resolvedFrom: resolved.resolvedFrom,
    values,
  };

  return { observed, resolved };
}

module.exports = {
  DEFAULT_WARMUP_SEC,
  DEFAULT_WINDOW_SEC,
  runObserve,
  parseMetricLine,
  samplesFromLogs,
};
