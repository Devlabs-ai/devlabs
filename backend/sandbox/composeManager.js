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

async function waitForServices(buildDir, portMap, maxWaitMs = 60000) {
  const start = Date.now();
  let lastStatus = '';

  while (Date.now() - start < maxWaitMs) {
    try {
      const { stdout } = await runCompose(['ps', '--format', 'json'], {
        cwd: buildDir,
        env: envWithPorts(portMap),
      });
      const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      const services = [];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          services.push(obj);
        } catch (_e) {
          try {
            const arr = JSON.parse(stdout);
            if (Array.isArray(arr)) {
              for (const s of arr) services.push(s);
              break;
            }
          } catch (_ee) { /* ignore */ }
        }
      }

      if (services.length === 0) {
        lastStatus = 'no services found';
      } else {
        const states = services.map((s) => s.State || s.state || 'unknown');
        lastStatus = states.join(', ');
        const allRunning = states.every((s) => s === 'running');
        if (allRunning) {
          console.log(`[compose] waitForServices OK: ${lastStatus}`);
          return true;
        }
      }
    } catch (e) {
      lastStatus = `ps error: ${e.message}`;
    }

    await new Promise((r) => setTimeout(r, 3000));
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
};
