import React, { useEffect, useRef, useState } from 'react';

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export default function AgentObserverPanel({ wsUrl, onEvaluation }) {
  const [commands, setCommands] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!wsUrl) return undefined;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'command') {
          setCommands((c) => [...c, { cmd: msg.cmd, ts: Date.now() }].slice(-150));
        } else if (msg.type === 'evaluation_done') {
          onEvaluation && onEvaluation(msg.evaluation);
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
