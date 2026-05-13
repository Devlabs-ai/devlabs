'use strict';

const sessionStore = require('../db/sessionStore');
const bus = require('./terminalEventBus');

const MAX_OUTPUT_CHARS = 600;

function parseQuery(req) {
  try {
    return new URL(req.url, `http://${req.headers.host}`).searchParams;
  } catch (_e) {
    return new URLSearchParams();
  }
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch (_e) { /* noop */ }
  }
}

function isPrintable(byte) {
  return byte >= 0x20 && byte <= 0x7e;
}

function makeKeystrokeReconstructor({ onCommand }) {
  let pending = '';
  let inEscape = false;
  let escapeBuf = '';

  return function feed(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];

      if (inEscape) {
        escapeBuf += String.fromCharCode(b);
        // ANSI escape sequences end with a letter (0x40-0x7e) for most CSI/OSC
        if ((b >= 0x40 && b <= 0x7e) || b === 0x07) {
          inEscape = false;
          escapeBuf = '';
        }
        continue;
      }

      if (b === 0x1b) {
        inEscape = true;
        escapeBuf = '';
        continue;
      }

      if (b === 0x0d || b === 0x0a) {
        const cmd = pending.trim();
        pending = '';
        if (cmd) onCommand(cmd);
        continue;
      }

      if (b === 0x7f || b === 0x08) {
        pending = pending.slice(0, -1);
        continue;
      }

      if (b === 0x03) {
        pending = '';
        continue;
      }

      if (isPrintable(b)) {
        pending += String.fromCharCode(b);
      }
    }
  };
}

function handleConnection(ws, req) {
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

  send(ws, { type: 'connected', sessionId });

  let lastEntry = null;
  let outputCharsSinceCommand = 0;

  const feed = makeKeystrokeReconstructor({
    onCommand: (cmd) => {
      send(ws, { type: 'command', cmd });
      const entry = { cmd, output: '' };
      const current = sessionStore.get(sessionId);
      if (current) {
        current.commandHistory = current.commandHistory || [];
        current.commandHistory.push(entry);
        sessionStore.set(sessionId, current);
      }
      lastEntry = entry;
      outputCharsSinceCommand = 0;
    },
  });

  const onStdin = ({ sessionId: sid, data }) => {
    if (sid !== sessionId) return;
    feed(data);
  };

  const onStdout = ({ sessionId: sid, data }) => {
    if (sid !== sessionId) return;
    if (!lastEntry) return;
    if (outputCharsSinceCommand >= MAX_OUTPUT_CHARS) return;
    const text = (Buffer.isBuffer(data) ? data : Buffer.from(data)).toString('utf8');
    const remaining = MAX_OUTPUT_CHARS - outputCharsSinceCommand;
    const slice = text.slice(0, remaining);
    lastEntry.output += slice;
    outputCharsSinceCommand += slice.length;
  };

  const onSessionEnd = ({ sessionId: sid, evaluation }) => {
    if (sid !== sessionId) return;
    send(ws, { type: 'evaluation_done', evaluation });
  };

  bus.on('stdin', onStdin);
  bus.on('stdout', onStdout);
  bus.on('session_end', onSessionEnd);

  const cleanup = () => {
    bus.off('stdin', onStdin);
    bus.off('stdout', onStdout);
    bus.off('session_end', onSessionEnd);
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

module.exports = { handleConnection };
