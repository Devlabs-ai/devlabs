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
}

export default function TerminalPanel({ wsUrl, isActive = true }: TerminalPanelProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);

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
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fitRef.current = fit;

    try { fit.fit(); } catch (_e) { /* size not ready */ }

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    const attach = new AttachAddon(ws);
    term.loadAddon(attach);

    const resizeObserver = new ResizeObserver(() => {
      try { fit.fit(); } catch (_e) { /* noop */ }
    });
    resizeObserver.observe(hostRef.current);

    return () => {
      resizeObserver.disconnect();
      try { ws.close(); } catch (_e) { /* noop */ }
      try { term.dispose(); } catch (_e) { /* noop */ }
      fitRef.current = null;
    };
  }, [wsUrl]);

  useEffect(() => {
    if (!isActive || !fitRef.current) return;
    const id = window.requestAnimationFrame(() => {
      try { fitRef.current && fitRef.current.fit(); } catch (_e) { /* noop */ }
    });
    return () => window.cancelAnimationFrame(id);
  }, [isActive]);

  return (
    <div className="terminal-host">
      <div ref={hostRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
