import React, { useState, useRef, useCallback } from 'react';

export default function BrowserTab() {
  const [inputUrl, setInputUrl] = useState('http://localhost:');
  const [committedUrl, setCommittedUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const iframeRef = useRef(null);
  const inputRef = useRef(null);

  const canBack = historyIdx > 0;
  const canForward = historyIdx < history.length - 1;

  const commit = useCallback((url) => {
    const normalized = url.trim();
    if (!normalized) return;
    const withScheme = /^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`;
    setCommittedUrl(withScheme);
    setInputUrl(withScheme);
    setLoadError(false);
    setLoading(true);
    setHistory((prev) => {
      const next = prev.slice(0, historyIdx + 1);
      next.push(withScheme);
      setHistoryIdx(next.length - 1);
      return next;
    });
  }, [historyIdx]);

  const handleGo = () => commit(inputUrl);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleGo();
  };

  const handleBack = () => {
    if (!canBack) return;
    const idx = historyIdx - 1;
    const url = history[idx];
    setHistoryIdx(idx);
    setInputUrl(url);
    setCommittedUrl(url);
    setLoadError(false);
    setLoading(true);
  };

  const handleForward = () => {
    if (!canForward) return;
    const idx = historyIdx + 1;
    const url = history[idx];
    setHistoryIdx(idx);
    setInputUrl(url);
    setCommittedUrl(url);
    setLoadError(false);
    setLoading(true);
  };

  const handleReload = () => {
    if (!committedUrl || !iframeRef.current) return;
    setLoadError(false);
    setLoading(true);
    iframeRef.current.src = committedUrl;
  };

  const handleOpenExternal = () => {
    const url = committedUrl || inputUrl.trim();
    if (!url) return;
    const withScheme = /^https?:\/\//i.test(url) ? url : `http://${url}`;
    window.open(withScheme, '_blank', 'noopener');
  };

  const handleInputFocus = () => inputRef.current?.select();

  return (
    <div className="browser-tab">
      <div className="browser-bar">
        <button
          className="browser-nav-btn"
          onClick={handleBack}
          disabled={!canBack}
          title="Back"
        >‹</button>
        <button
          className="browser-nav-btn"
          onClick={handleForward}
          disabled={!canForward}
          title="Forward"
        >›</button>
        <button
          className="browser-nav-btn"
          onClick={committedUrl ? handleReload : handleGo}
          title={committedUrl ? 'Reload' : 'Go'}
          disabled={loading && !loadError}
        >
          {loading && !loadError ? (
            <span className="browser-spinner" />
          ) : '↺'}
        </button>

        <div className="browser-url-wrap">
          <input
            ref={inputRef}
            className="browser-url-input"
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            spellCheck={false}
            autoComplete="off"
            placeholder="http://localhost:8080"
          />
        </div>

        <button
          className="browser-nav-btn"
          onClick={handleOpenExternal}
          title="Open in new browser tab"
        >↗</button>
      </div>

      {!committedUrl ? (
        <div className="browser-prompt">
          <div className="browser-prompt-inner">
            <div className="browser-prompt-icon">⬡</div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Enter a URL above and press <kbd>Enter</kbd> to load
            </p>
          </div>
        </div>
      ) : loadError ? (
        <div className="browser-prompt">
          <div className="browser-prompt-inner">
            <div className="browser-prompt-icon" style={{ color: 'var(--danger)' }}>✕</div>
            <p style={{ fontWeight: 600 }}>Failed to load</p>
            <code style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{committedUrl}</code>
            <p className="dim" style={{ fontSize: 12 }}>
              The service may be starting up, blocking iframes (<code>X-Frame-Options</code>), or not serving HTTP on this URL.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="sm" onClick={handleReload}>Retry</button>
              <button className="ghost sm" onClick={handleOpenExternal}>Open in new tab ↗</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="browser-frame-wrapper">
          {loading && <div className="browser-loading-bar" />}
          <iframe
            ref={iframeRef}
            className="browser-frame"
            src={committedUrl}
            title="sandbox-preview"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setLoadError(true); }}
          />
        </div>
      )}
    </div>
  );
}
