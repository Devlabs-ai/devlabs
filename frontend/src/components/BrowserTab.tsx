import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  directServiceUrl,
  isMixedContentBlocked,
  isBrowseProxyErrorPayload,
  normalizeBrowseUrl,
  pickDefaultBrowseService,
  displayBrowseUrl,
  proxiedBrowseUrl,
  sandboxHost,
  servicesFromPortMap,
} from '../utils/sandboxBrowse';

interface BrowserTabProps {
  sessionId: string | null;
  portMap: Record<string, string | number> | null;
}

type BlockReason = 'mixed-content' | 'proxy-failed' | 'embed-failed' | null;

export default function BrowserTab({ sessionId, portMap }: BrowserTabProps): JSX.Element {
  const services = useMemo(() => servicesFromPortMap(portMap), [portMap]);
  const defaultService = useMemo(() => pickDefaultBrowseService(portMap), [portMap]);
  const [activeService, setActiveService] = useState<string | null>(defaultService);
  const [inputUrl, setInputUrl] = useState<string>('');
  const [committedUrl, setCommittedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [blockReason, setBlockReason] = useState<BlockReason>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sessionId) return;
    const def = pickDefaultBrowseService(portMap);
    if (def) setActiveService(def);
  }, [sessionId, portMap]);

  const canEmbed = sessionId && activeService;
  const proxiedUrl = canEmbed ? proxiedBrowseUrl(sessionId, activeService) : null;
  const port = services.find((s) => s.id === activeService)?.port;
  const directUrl = activeService && port != null
    ? directServiceUrl(port, sandboxHost())
    : null;

  const loadEmbedUrl = useCallback((iframeSrc: string, addressBarUrl: string | null = null): void => {
    const withScheme = normalizeBrowseUrl(iframeSrc);
    if (!withScheme) return;
    const shown = addressBarUrl || withScheme;

    if (isMixedContentBlocked(withScheme)) {
      setCommittedUrl(withScheme);
      setInputUrl(shown);
      setLoadError(true);
      setBlockReason('mixed-content');
      setLoading(false);
      return;
    }

    setCommittedUrl(withScheme);
    setInputUrl(shown);
    setLoadError(false);
    setBlockReason(null);
    setLoading(true);
  }, []);

  useEffect(() => {
    if (!proxiedUrl || !sessionId) {
      setCommittedUrl(null);
      return;
    }
    const display = displayBrowseUrl(sessionId, activeService) || proxiedUrl;
    loadEmbedUrl(proxiedUrl, display);
  }, [proxiedUrl, sessionId, activeService, loadEmbedUrl]);

  useEffect(() => {
    if (!loading || loadError || !committedUrl) return undefined;
    const timer = window.setTimeout(() => {
      setLoading(false);
    }, 25_000);
    return () => window.clearTimeout(timer);
  }, [loading, loadError, committedUrl]);

  const commit = useCallback((url: string): void => {
    const withScheme = normalizeBrowseUrl(url);
    if (!withScheme) return;
    const shown = url.startsWith('/') && sessionId && activeService
      ? (displayBrowseUrl(sessionId, activeService) || url)
      : url;
    loadEmbedUrl(withScheme, shown);
    setHistory((prev) => {
      const next = prev.slice(0, historyIdx + 1);
      next.push(shown);
      setHistoryIdx(next.length - 1);
      return next;
    });
  }, [historyIdx, sessionId, activeService, loadEmbedUrl]);

  const handleGo = (): void => commit(inputUrl);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') handleGo();
  };

  const handleSelectService = (serviceId: string): void => {
    setActiveService(serviceId);
    if (!sessionId) {
      const svc = services.find((s) => s.id === serviceId);
      if (svc) commit(directServiceUrl(svc.port));
    }
  };

  const canBack = historyIdx > 0;
  const canForward = historyIdx < history.length - 1;

  const handleBack = (): void => {
    if (!canBack) return;
    const idx = historyIdx - 1;
    const url = history[idx];
    setHistoryIdx(idx);
    loadEmbedUrl(url, url);
  };

  const handleForward = (): void => {
    if (!canForward) return;
    const idx = historyIdx + 1;
    const url = history[idx];
    setHistoryIdx(idx);
    loadEmbedUrl(url, url);
  };

  const handleReload = (): void => {
    if (!committedUrl) return;
    setLoadError(false);
    setBlockReason(null);
    setLoading(true);
    if (iframeRef.current) {
      iframeRef.current.src = committedUrl;
    }
  };

  const handleOpenExternal = (): void => {
    const url = directUrl || committedUrl || inputUrl.trim();
    if (!url) return;
    const external = url.startsWith('/')
      ? directUrl || normalizeBrowseUrl(url)
      : normalizeBrowseUrl(url);
    if (!external || external.startsWith('/')) return;
    window.open(external, '_blank', 'noopener,noreferrer');
  };

  const handleInputFocus = (): void => inputRef.current?.select();

  const handleIframeLoad = (): void => {
    setLoading(false);
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc?.body) return;
      const text = (doc.body.innerText || '').trim();
      if (isBrowseProxyErrorPayload(text)) {
        setLoadError(true);
        setBlockReason('proxy-failed');
        return;
      }
      setLoadError(false);
      setBlockReason(null);
    } catch (_e) {
      /* cross-origin — treat as loaded */
      setLoadError(false);
      setBlockReason(null);
    }
  };

  return (
    <div className="browser-tab">
      {services.length > 0 && (
        <div className="browser-service-bar">
          <span className="browser-service-label">Services</span>
          <div className="browser-service-chips">
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`browser-service-chip ${activeService === s.id ? 'active' : ''}`}
                onClick={() => handleSelectService(s.id)}
                title={`Host port ${s.port}`}
              >
                {s.id}
              </button>
            ))}
          </div>
          {directUrl && sandboxHost() === 'localhost' && (
            <button type="button" className="ghost sm browser-open-direct" onClick={handleOpenExternal}>
              Open {activeService || 'service'} on host ↗
            </button>
          )}
        </div>
      )}

      <div className="browser-bar">
        <button type="button" className="browser-nav-btn" onClick={handleBack} disabled={!canBack} title="Back">‹</button>
        <button type="button" className="browser-nav-btn" onClick={handleForward} disabled={!canForward} title="Forward">›</button>
        <button
          type="button"
          className="browser-nav-btn"
          onClick={committedUrl ? handleReload : handleGo}
          title={committedUrl ? 'Reload' : 'Go'}
          disabled={loading && !loadError}
        >
          {loading && !loadError ? <span className="browser-spinner" /> : '↺'}
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
            placeholder="Loads via platform proxy (/api/session/…/browse/…)"
          />
        </div>

        {sandboxHost() === 'localhost' && directUrl && (
          <button
            type="button"
            className="browser-nav-btn"
            onClick={handleOpenExternal}
            title={`Open on host (${directUrl})`}
          >
            ↗
          </button>
        )}
      </div>

      {!committedUrl ? (
        <div className="browser-prompt">
          <div className="browser-prompt-inner">
            <div className="browser-prompt-icon">⬡</div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {sessionId
                ? 'Pick a service chip — web UIs load through the Devlabs proxy, not raw localhost ports.'
                : 'Start a sandbox session to browse services here.'}
            </p>
          </div>
        </div>
      ) : loadError ? (
        <div className="browser-prompt">
          <div className="browser-prompt-inner">
            <div className="browser-prompt-icon" style={{ color: 'var(--danger)' }}>✕</div>
            <p style={{ fontWeight: 600 }}>Embedded browser could not load this service</p>
            <code style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
              {inputUrl || committedUrl}
            </code>
            {blockReason === 'mixed-content' && (
              <p className="dim" style={{ fontSize: 12 }}>
                Devlabs is on HTTPS but a direct HTTP URL was used. Use the{' '}
                <strong>/api/session/…/browse/…</strong> proxy path.
              </p>
            )}
            {blockReason === 'proxy-failed' && (
              <p className="dim" style={{ fontSize: 12 }}>
                The browse proxy returned an error. Wait until the container is healthy, then click Retry.
                {directUrl && (
                  <> On local dev you can also use <strong>Open on host ↗</strong> ({directUrl}).</>
                )}
              </p>
            )}
            {blockReason === 'embed-failed' && (
              <p className="dim" style={{ fontSize: 12 }}>
                The iframe failed to load. Retry or use Open on host ↗ if available.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" className="sm" onClick={handleReload}>Retry</button>
              {directUrl && (
                <button type="button" className="ghost sm" onClick={handleOpenExternal}>
                  Open on host ↗
                </button>
              )}
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
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
            onLoad={handleIframeLoad}
            onError={() => { setLoading(false); setLoadError(true); setBlockReason('embed-failed'); }}
          />
        </div>
      )}
    </div>
  );
}
