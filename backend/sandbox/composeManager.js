'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const portAllocator = require('./portAllocator');

function runCompose(args, { cwd, env = {}, captureOutput = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    let stdout = '';
    let stderr = '';
    if (captureOutput) {
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(`docker compose ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`);
        err.stdout = stdout;
        err.stderr = stderr;
        err.exitCode = code;
        reject(err);
      }
    });
  });
}

function envWithPorts(portMap) {
  const out = {};
  for (const [k, v] of Object.entries(portMap || {})) {
    out[k] = String(v);
  }
  return out;
}

async function up(buildDir, portMap) {
  console.log(`[compose] up -d in ${buildDir}`);
  return runCompose(['up', '--build', '-d'], {
    cwd: buildDir,
    env: envWithPorts(portMap),
  });
}

async function down(buildDir) {
  console.log(`[compose] down -v in ${buildDir}`);
  return runCompose(['down', '--remove-orphans', '-v'], {
    cwd: buildDir,
    env: envWithPorts({}),
  }).catch((e) => {
    console.warn(`[compose] down failed for ${buildDir}: ${e.message}`);
    return null;
  });
}

async function exec(buildDir, service, cmd, { portMap = {} } = {}) {
  const args = ['exec', '-T', service, ...cmd];
  return runCompose(args, { cwd: buildDir, env: envWithPorts(portMap) });
}

async function ps(buildDir, service, { portMap = {} } = {}) {
  const { stdout } = await runCompose(['ps', '-q', service], {
    cwd: buildDir,
    env: envWithPorts(portMap),
  });
  return stdout.trim();
}

async function getPort(buildDir, service, internalPort, { portMap = {} } = {}) {
  const { stdout } = await runCompose(['port', service, String(internalPort)], {
    cwd: buildDir,
    env: envWithPorts(portMap),
  });
  const out = stdout.trim();
  if (!out) return null;
  const m = out.match(/:(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

function placeholderFields(composeYaml) {
  const fields = new Set();
  const re = /\$\{(HOST_PORT_[A-Z0-9_]+)\}/g;
  let m;
  while ((m = re.exec(composeYaml)) !== null) {
    fields.add(m[1]);
  }
  return Array.from(fields);
}

// Strip Docker pull/build progress noise from compose stdout/stderr. Lines
// like "083e1d04595f Downloading [==>] 1MB/87MB", "kafka Pulling", and
// "131f1a26eef0 Extracting 3 s" carry no signal once a pull is over but
// can balloon retry context to >100KB and trigger TPM rate limits.
const _NOISE_PATTERNS = [
  /\bPulling fs layer\s*$/,
  /\bPulling\s*$/,
  /\bPulled\s*$/,
  /\bPull complete\s*$/,
  /\bDownloading\s*\[/,
  /\bDownload complete\s*$/,
  /\bDownloaded newer image\b/,
  /\bExtracting\s+\d+\s*s\s*$/,
  /\bVerifying Checksum\s*$/,
  /\bWaiting\s*$/,
  /\bAlready exists\s*$/,
  /\bInterrupted\s*$/,
];

function stripDockerNoise(s) {
  if (!s || typeof s !== 'string') return s;
  return s
    .split('\n')
    .filter((line) => {
      const t = line.trimEnd();
      if (/^time="[^"]+" level=warning msg=/.test(t.trim())) return false;
      for (const re of _NOISE_PATTERNS) {
        if (re.test(t)) return false;
      }
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

// Extract every `build.context` path declared in a docker-compose YAML.
// Supports both short form (`build: ./path`) and block form
// (`build:\n      context: ./path`). Returns [{ service, contextPath }, ...].
// Best-effort, tolerant parser for the constrained 2-space-indent layout we
// expect; not a full YAML implementation.
function extractBuildContexts(composeYaml) {
  if (!composeYaml || typeof composeYaml !== 'string') return [];
  const out = [];
  const lines = composeYaml.split('\n').map((l) => l.replace(/\r$/, ''));
  let inServices = false;
  let currentService = null;
  let inBuildBlock = false;
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^[A-Za-z_][\w-]*\s*:/.test(line)) {
      inServices = /^services\s*:/.test(line);
      currentService = null;
      inBuildBlock = false;
      continue;
    }
    if (!inServices) continue;
    const svcM = line.match(/^  ([A-Za-z][\w-]*)\s*:\s*(?:#.*)?$/);
    if (svcM) {
      currentService = svcM[1];
      inBuildBlock = false;
      continue;
    }
    if (!currentService) continue;
    const shortM = line.match(/^    build\s*:\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/);
    if (shortM) {
      out.push({ service: currentService, contextPath: shortM[1] });
      inBuildBlock = false;
      continue;
    }
    if (/^    build\s*:\s*(?:#.*)?$/.test(line)) {
      inBuildBlock = true;
      continue;
    }
    if (inBuildBlock) {
      // Any line with <=4 leading spaces means we exited the build block.
      const indMatch = line.match(/^( +)/);
      const ind = indMatch ? indMatch[1].length : 0;
      if (ind <= 4) {
        inBuildBlock = false;
      } else {
        const ctxM = line.match(/^\s+context\s*:\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/);
        if (ctxM) out.push({ service: currentService, contextPath: ctxM[1] });
      }
    }
  }
  return out;
}

// Extract top-level service names from a docker-compose YAML string.
// Handles standard 2-space indentation; ignores comments, anchors, etc.
function extractServiceNames(composeYaml) {
  const services = [];
  const lines = (composeYaml || '').split('\n');
  let inServices = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^[a-zA-Z_][\w-]*\s*:/.test(line)) {
      inServices = /^services\s*:/.test(line);
      continue;
    }
    if (!inServices) continue;
    const m = line.match(/^[ \t]{2}([a-zA-Z][\w-]*)\s*:\s*(?:#.*)?$/);
    if (m) services.push(m[1]);
  }
  return services;
}

async function resolvePortMap(buildDir, composeYaml, ownerId, { pool = 'session' } = {}) {
  const fields = placeholderFields(composeYaml);
  if (fields.length === 0) return {};
  const portMap = await portAllocator.allocateNIn(pool, ownerId, fields);
  return portMap;
}

// Wait until every compose service is `running` AND stays that way long
// enough that we're not racing against a crash-on-boot. Three guarantees:
//
//   1. `--all` — exited / dead containers stay visible in the ps output so we
//      can fail fast instead of timing out with "no services found".
//   2. Fail-fast on `exited` / `dead` state. No reason to keep polling once
//      we have ground truth that a container died.
//   3. Stability check — require N consecutive observations of "all running"
//      before declaring success. Without this, the very first poll catches
//      containers mid-boot and reports them as running for a few hundred ms
//      before they crash (e.g. Confluent Kafka exiting because
//      KAFKA_PROCESS_ROLES is unset).
async function waitForServices(buildDir, portMap, maxWaitMs = 60000) {
  const POLL_INTERVAL_MS = 3000;
  const STABLE_POLLS_REQUIRED = 3; // ~9s of consecutive "all running"
  const start = Date.now();
  let stableCount = 0;
  let lastStatus = '';

  while (Date.now() - start < maxWaitMs) {
    let services = [];
    try {
      const { stdout } = await runCompose(['ps', '--all', '--format', 'json'], {
        cwd: buildDir,
        env: envWithPorts(portMap),
      });
      const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        try {
          services.push(JSON.parse(line));
        } catch (_e) {
          // older Compose versions emit a single JSON array on one line
          try {
            const arr = JSON.parse(stdout);
            if (Array.isArray(arr)) { services = arr; break; }
          } catch (_ee) { /* ignore */ }
        }
      }
    } catch (e) {
      lastStatus = `ps error: ${e.message}`;
      stableCount = 0;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    if (services.length === 0) {
      lastStatus = 'no services found';
      stableCount = 0;
    } else {
      lastStatus = services
        .map((s) => `${s.Service || s.Name}=${s.State}${s.Status ? ` (${s.Status})` : ''}`)
        .join('; ');

      // Hard fail: any exited / dead container means the boot is broken.
      // Throwing here lets the build agent capture compose logs immediately
      // instead of waiting out the 90s timeout.
      const dead = services.find((s) => /^(exited|dead)$/i.test(s.State || ''));
      if (dead) {
        throw new Error(
          `service "${dead.Service || dead.Name}" ${dead.State}: ${dead.Status || 'unknown reason'}`,
        );
      }

      const allRunning = services.every((s) => (s.State || '').toLowerCase() === 'running');
      if (allRunning) {
        stableCount += 1;
        console.log(`[compose] waitForServices stable ${stableCount}/${STABLE_POLLS_REQUIRED}: ${lastStatus}`);
        if (stableCount >= STABLE_POLLS_REQUIRED) {
          console.log(`[compose] waitForServices OK after ${stableCount} stable polls`);
          return true;
        }
      } else {
        stableCount = 0;
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`waitForServices timed out (${maxWaitMs}ms). Last status: ${lastStatus}`);
}

function readComposeFile(buildDir) {
  const candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
  for (const name of candidates) {
    const p = path.join(buildDir, name);
    if (fs.existsSync(p)) {
      return { path: p, content: fs.readFileSync(p, 'utf8') };
    }
  }
  throw new Error(`no compose file found in ${buildDir}`);
}

module.exports = {
  runCompose,
  up,
  down,
  exec,
  ps,
  getPort,
  resolvePortMap,
  waitForServices,
  readComposeFile,
  placeholderFields,
  extractServiceNames,
  extractBuildContexts,
  stripDockerNoise,
};
