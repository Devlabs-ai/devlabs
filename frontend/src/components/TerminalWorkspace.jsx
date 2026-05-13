import React, { useEffect, useState } from 'react';
import TerminalPanel from './TerminalPanel.jsx';

function withContainer(baseUrl, container) {
  try {
    // baseUrl is e.g. ws://localhost:5173/ws/terminal?sessionId=...
    const u = new URL(baseUrl);
    if (container) u.searchParams.set('container', container);
    return u.toString();
  } catch (_e) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    return container ? `${baseUrl}${sep}container=${encodeURIComponent(container)}` : baseUrl;
  }
}

export default function TerminalWorkspace({ services, baseWsUrl, defaultService }) {
  const initial = defaultService || services?.[0] || null;
  const [active, setActive] = useState(initial);
  const [opened, setOpened] = useState(() => (initial ? new Set([initial]) : new Set()));

  useEffect(() => {
    if (initial && !opened.has(initial)) {
      setOpened((prev) => new Set(prev).add(initial));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const handleSelect = (svc) => {
    setActive(svc);
    setOpened((prev) => {
      if (prev.has(svc)) return prev;
      const next = new Set(prev);
      next.add(svc);
      return next;
    });
  };

  if (!services || services.length === 0) {
    return (
      <div className="terminal-shell">
        <div className="service-tabs empty">No services available</div>
      </div>
    );
  }

  return (
    <div className="terminal-shell">
      <div className="service-tabs">
        {services.map((svc) => (
          <button
            key={svc}
            className={`service-tab ${active === svc ? 'active' : ''}`}
            onClick={() => handleSelect(svc)}
            title={`Open shell in ${svc}`}
          >
            <span className="dot" />
            {svc}
          </button>
        ))}
      </div>
      <div className="terminal-stack">
        {Array.from(opened).map((svc) => (
          <div
            key={svc}
            className="terminal-pane"
            style={{ display: active === svc ? 'block' : 'none' }}
          >
            <TerminalPanel
              wsUrl={withContainer(baseWsUrl, svc)}
              isActive={active === svc}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
