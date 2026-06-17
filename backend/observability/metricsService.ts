'use strict';

import type { IncomingMessage } from 'http';
import type { ChildProcess } from 'child_process';
import type { PortMap } from '../types/domain';
import type { ObservabilityWebSocket } from '../types/ws';

const { spawn } = require('child_process');
const sessionStore = require('../db/sessionStore');
const bus = require('./terminalEventBus');

const METRIC_RE = /METRIC\s+latency=([\d.]+)\s+errors=([\d.]+)\s+dbCpu=([\d.]+)/;
const RECOVERY_THRESHOLD_MS = 50;
const RECOVERY_REQUIRED = 10;

function parseQuery(req: IncomingMessage): URLSearchParams {
  try {
    return new URL(req.url || '', `http://${(req.headers as Record<string, string>).host}`).searchParams;
  } catch (_e) {
    return new URLSearchParams();
  }
}

function envWithPorts(portMap: PortMap | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(portMap || {})) {
    out[k] = String(v);
  }
  return out;
}

function send(ws: ObservabilityWebSocket, obj: unknown): void {
  if (ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch (_e) { /* noop */ }
  }
}

function stripDockerLogFrames(buf: Buffer): Buffer {
  // Docker multiplexed stream: [STREAM_TYPE(1)][0][0][0][SIZE(4 BE)][PAYLOAD]
  // When we use --no-color it can still arrive framed depending on container TTY.
  // We try to detect frames; if not present, return buf as-is.
  if (buf.length < 8) return buf;
  const streamType = buf[0];
  const padOk = buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if ((streamType === 1 || streamType === 2) && padOk) {
    const size = buf.readUInt32BE(4);
    if (size + 8 <= buf.length) {
      const payload = buf.slice(8, 8 + size);
      const rest = buf.slice(8 + size);
      if (rest.length > 0) {
        return Buffer.concat([payload, stripDockerLogFrames(rest)]);
      }
      return payload;
    }
  }
  return buf;
}

function handleConnection(ws: ObservabilityWebSocket, req: IncomingMessage): void {
  const q = parseQuery(req);
  const sessionId = q.get('sessionId');

  if (!sessionId) {
    send(ws, { type: 'error', message: 'sessionId is required' });
    ws.close();
    return;
  }

  const session = sessionStore.get(sessionId);
  if (!session) {
    send(ws, { type: 'error', message: 'session not found' });
    ws.close();
    return;
  }

  const service: string | null = session.metricsService;
  if (!service) {
    send(ws, { type: 'error', message: 'session has no metricsService configured' });
    ws.close();
    return;
  }

  if (!session.buildDir) {
    send(ws, { type: 'error', message: 'session has no sandbox running' });
    ws.close();
    return;
  }

  const args = ['compose', 'logs', '-f', '--no-color', '--tail=20', service];

  console.log(`[metrics] session=${sessionId} service=${service}`);

  const child: ChildProcess = spawn('docker', args, {
    cwd: session.buildDir,
    env: { ...process.env, ...envWithPorts(session.portMap) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buffer = '';
  let closed = false;

  const closeAll = () => {
    if (closed) return;
    closed = true;
    try { child.kill('SIGTERM'); } catch (_e) { /* noop */ }
    if (ws.readyState === ws.OPEN) ws.close();
  };

  const handleLine = (line: string) => {
    const m = line.match(METRIC_RE);
    if (!m) return;
    const latency = parseFloat(m[1]);
    const errors = parseFloat(m[2]);
    const dbCpu = parseFloat(m[3]);
    const ts = Date.now();
    send(ws, { type: 'metric', data: { latency, errors, dbCpu }, timestamp: ts });

    const current = sessionStore.get(sessionId);
    if (!current) return;

    if (latency < RECOVERY_THRESHOLD_MS) {
      current.recoveryCounter = (current.recoveryCounter || 0) + 1;
    } else {
      current.recoveryCounter = 0;
    }

    if (!current.recovered && current.recoveryCounter >= RECOVERY_REQUIRED) {
      current.recovered = true;
      sessionStore.set(sessionId, current);
      sessionStore.persistRow(current).catch((err: Error) =>
        console.warn('[metrics] persist recovered failed', err.message),
      );
      send(ws, { type: 'recovered', sessionId });
    } else {
      sessionStore.set(sessionId, current);
    }
  };

  const onData = (raw: unknown) => {
    const stripped = stripDockerLogFrames(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string));
    buffer += stripped.toString('utf8');
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) handleLine(line);
    }
  };

  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);

  child.on('error', (err: Error) => {
    send(ws, { type: 'error', message: `metrics spawn failed: ${err.message}` });
    closeAll();
  });

  child.on('close', () => {
    closeAll();
  });

  ws.on('close', closeAll);
  ws.on('error', closeAll);

  bus.on('session_end', function onEnd(payload: { sessionId?: string }) {
    if (payload && payload.sessionId === sessionId) {
      bus.off('session_end', onEnd);
      closeAll();
    }
  });
}

module.exports = { handleConnection };
