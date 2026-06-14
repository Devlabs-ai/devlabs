import React, { useEffect, useRef, useState } from 'react';

interface CommandEntry {
  cmd: string;
  ts: number;
}

interface AgentObserverPanelProps {
  wsUrl: string | null;
  onEvaluation?: (evaluation: unknown) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export default function AgentObserverPanel({ wsUrl, onEvaluation }: AgentObserverPanelProps): JSX.Element {
  const [commands, setCommands] = useState<CommandEntry[]>([]);
  const [connected, setConnected] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wsUrl) return undefined;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = (): void => setConnected(true);
    ws.onclose = (): void => setConnected(false);
    ws.onmessage = (ev: MessageEvent): void => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; cmd?: string; evaluation?: unknown };
        if (msg.type === 'command') {
          setCommands((c) => [...c, { cmd: msg.cmd ?? '', ts: Date.now() }].slice(-150));
        }
      } catch (_e) {
        /* ignore */
      }
    };

    return () => {
      try { ws.close(); } catch (_e) { /* noop */ }
    };
  }, [wsUrl, onEvaluation]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [commands]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className={`badge ${connected ? 'brand' : ''}`}>
          <span className="dot" /> {connected ? 'live' : 'connecting…'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {commands.length} {commands.length === 1 ? 'command' : 'commands'}
        </span>
      </div>
      <div ref={listRef} style={{ maxHeight: 'calc(100% - 32px)', overflow: 'auto' }}>
        {commands.length === 0 && (
          <div className="observer-empty">
            Commands typed into the terminal will appear here in real time.
          </div>
        )}
        {commands.map((c, i) => (
          <div className="observer-cmd" key={i}>
            <span className="prompt">$</span>
            <span className="cmd">{c.cmd}</span>
            <span className="ts">{formatTime(c.ts)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
