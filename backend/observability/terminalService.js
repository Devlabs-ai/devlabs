'use strict';

const pty = require('node-pty');
const sessionStore = require('../db/sessionStore');
const bus = require('./terminalEventBus');

function parseQuery(req) {
  try {
    return new URL(req.url, `http://${req.headers.host}`).searchParams;
  } catch (_e) {
    return new URLSearchParams();
  }
}

function pickTerminalService(session, requested) {
  if (requested) return requested;
  if (session.terminalService) return session.terminalService;
  return 'postgres';
}

function envWithPorts(portMap) {
  const out = {};
  for (const [k, v] of Object.entries(portMap || {})) {
    out[k] = String(v);
  }
  return out;
}

function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    try { ws.send(data); } catch (_e) { /* socket dead */ }
  }
}

function sendJson(ws, obj) {
  send(ws, JSON.stringify(obj));
}

function handleConnection(ws, req) {
  const q = parseQuery(req);
  const sessionId = q.get('sessionId');
  const containerKey = q.get('container');

  if (!sessionId) {
    sendJson(ws, { type: 'error', message: 'sessionId is required' });
    ws.close();
    return;
  }

  const session = sessionStore.get(sessionId);
  if (!session) {
    sendJson(ws, { type: 'error', message: 'session not found' });
    ws.close();
    return;
  }

  if (!session.buildDir) {
    sendJson(ws, { type: 'error', message: 'session has no sandbox running' });
    ws.close();
    return;
  }

  const service = pickTerminalService(session, containerKey);

  // No -T so docker compose allocates an interactive TTY in the container.
  // We host the pty side via node-pty so docker sees a real PTY on stdin.
  // Use bash when available (postgres alpine has it), otherwise fall back to
  // sh (python:alpine etc. ship only busybox sh).
  const shellCmd = 'command -v bash >/dev/null 2>&1 && exec bash -l || exec sh';
  const args = ['compose', 'exec', service, 'sh', '-c', shellCmd];

  console.log(`[terminal] session=${sessionId} service=${service} spawn docker ${args.join(' ')}`);

  const cols = parseInt(q.get('cols') || '120', 10) || 120;
  const rows = parseInt(q.get('rows') || '32', 10) || 32;

  let child;
  try {
    child = pty.spawn('docker', args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: session.buildDir,
      env: { ...process.env, ...envWithPorts(session.portMap), TERM: 'xterm-256color' },
    });
  } catch (err) {
    sendJson(ws, { type: 'error', message: `terminal spawn failed: ${err.message}` });
    ws.close();
    return;
  }

  let closed = false;
  const closeAll = () => {
    if (closed) return;
    closed = true;
    try { child.kill('SIGTERM'); } catch (_e) { /* noop */ }
    if (ws.readyState === ws.OPEN) ws.close();
  };

  ws.on('message', (msg, _isBinary) => {
    const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
    try { child.write(buf.toString('utf8')); } catch (_e) { /* noop */ }
    bus.emit('stdin', { sessionId, data: buf });
  });

  child.onData((data) => {
    const buf = Buffer.from(data, 'utf8');
    send(ws, buf);
    bus.emit('stdout', { sessionId, data: buf });
  });

  child.onExit(({ exitCode, signal }) => {
    console.log(`[terminal] session=${sessionId} child exited code=${exitCode} signal=${signal}`);
    closeAll();
  });

  ws.on('close', closeAll);
  ws.on('error', closeAll);

  send(ws, Buffer.from(`\r\n[connected to ${service}]\r\n`));
}

module.exports = { handleConnection };
