import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { AttachAddon } from '@xterm/addon-attach';
import '@xterm/xterm/css/xterm.css';

const THEME = {
  background: '#000000',
  foreground: '#eef0ff',
  cursor: '#34d399',
  cursorAccent: '#000000',
  selectionBackground: 'rgba(52, 211, 153, 0.25)',
  black: '#000000',
  red: '#f43f5e',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#cbd5e1',
  brightBlack: '#475569',
  brightRed: '#fb7185',
  brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f1f5f9',
};

interface TerminalPanelProps {
  wsUrl: string;
  isActive?: boolean;
  /** When true, send {type:resize} to the PTY (needed for k8s lab). */
  resizeProtocol?: boolean;
  /** Called when the server closes the socket (not when this panel tears it down). */
  onDisconnect?: () => void;
}

export default function TerminalPanel({
  wsUrl,
  isActive = true,
  resizeProtocol = false,
  onDisconnect,
}: TerminalPanelProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const onDisconnectRef = useRef(onDisconnect);
  onDisconnectRef.current = onDisconnect;
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!wsUrl || !hostRef.current) return undefined;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      letterSpacing: 0,
      theme: THEME,
      convertEol: true,
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fitRef.current = fit;
    termRef.current = term;

    const sendResize = () => {
      try {
        fit.fit();
      } catch (_e) {
        /* size not ready */
      }
      const ws = wsRef.current;
      if (!resizeProtocol || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    try {
      fit.fit();
    } catch (_e) {
      /* size not ready */
    }

    // The server sizes the PTY and picks the intro banner from these, before the first
    // resize message arrives; a hidden host fits to nothing, so estimate from the viewport.
    let url = wsUrl;
    if (resizeProtocol) {
      const fitted = hostRef.current.clientWidth > 0;
      const cols = fitted ? term.cols : Math.max(20, Math.floor((window.innerWidth - 24) / 8));
      const rows = fitted ? term.rows : 24;
      url += `${wsUrl.includes('?') ? '&' : '?'}cols=${cols}&rows=${rows}`;
    }
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    ws.addEventListener('open', () => sendResize());
    let tearingDown = false;
    ws.addEventListener('close', () => {
      if (!tearingDown) onDisconnectRef.current?.();
    });
    const attach = new AttachAddon(ws);
    term.loadAddon(attach);

    const resizeObserver = new ResizeObserver(() => sendResize());
    resizeObserver.observe(hostRef.current);

    return () => {
      tearingDown = true;
      resizeObserver.disconnect();
      try {
        ws.close();
      } catch (_e) {
        /* noop */
      }
      try {
        term.dispose();
      } catch (_e) {
        /* noop */
      }
      fitRef.current = null;
      termRef.current = null;
      wsRef.current = null;
    };
  }, [wsUrl, resizeProtocol]);

  useEffect(() => {
    if (!isActive || !fitRef.current) return;
    const id = window.requestAnimationFrame(() => {
      try {
        fitRef.current && fitRef.current.fit();
        const term = termRef.current;
        const ws = wsRef.current;
        if (resizeProtocol && term && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch (_e) {
        /* noop */
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [isActive, resizeProtocol]);

  return (
    <div className="terminal-host">
      <div ref={hostRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
