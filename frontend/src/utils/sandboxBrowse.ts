interface SandboxService {
  id: string;
  port: string | number;
  envKey: string;
}

/** Host for URLs opened from the Devlabs UI (matches metrics endpoint links). */
export function sandboxHost(): string {
  if (typeof window === 'undefined') return 'localhost';
  return window.location.hostname || 'localhost';
}

export function serviceNameFromPortKey(key: string): string {
  return key.replace(/^HOST_PORT_/, '').toLowerCase().replace(/_/g, '-');
}

export function servicesFromPortMap(
  portMap: Record<string, string | number> | null | undefined,
): SandboxService[] {
  return Object.entries(portMap || {}).map(([key, port]) => ({
    id: serviceNameFromPortKey(key),
    port,
    envKey: key,
  }));
}

const UI_SERVICE_RE = /ui|dashboard|console|admin|kafka-ui|akhq|grafana|kibana|spark-master/i;

export function pickDefaultBrowseService(
  portMap: Record<string, string | number> | null | undefined,
): string | null {
  const list = servicesFromPortMap(portMap);
  if (!list.length) return null;
  const ui = list.find((s) => UI_SERVICE_RE.test(s.id));
  return (ui || list[0]).id;
}

export function directServiceUrl(port: string | number, host: string = sandboxHost()): string {
  return `http://${host}:${port}`;
}

/** Same-origin path served by the backend browse proxy (embeddable in iframe). */
export function proxiedBrowseUrl(
  sessionId: string | null | undefined,
  service: string | null | undefined,
): string | null {
  if (!sessionId || !service) return null;
  const base = `/api/session/${sessionId}/browse/${service}`;
  return base.endsWith('/') ? base : `${base}/`;
}

/** Human-readable URL for the address bar (same origin as the Devlabs app). */
export function displayBrowseUrl(
  sessionId: string | null | undefined,
  service: string | null | undefined,
): string | null {
  const path = proxiedBrowseUrl(sessionId, service);
  if (!path) return null;
  if (typeof window !== 'undefined' && path.startsWith('/')) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

export function isMixedContentBlocked(url: string): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol !== 'https:') return false;
  return /^http:/i.test(url);
}

/** True when the browse proxy returned a JSON error body (not an app UI message). */
export function isBrowseProxyErrorPayload(text: string | null, contentType: string = ''): boolean {
  const t = (text || '').trim();
  if (contentType.includes('application/json')) return true;
  if (!t.startsWith('{')) return false;
  return /"error"\s*:\s*"/.test(t)
    && /sandbox service unreachable|not accepting connections/i.test(t);
}

/** Normalize URL for iframe navigation (relative proxy paths must stay relative). */
export function normalizeBrowseUrl(url: string | null | undefined): string | null {
  const normalized = (url || '').trim();
  if (!normalized) return null;
  if (normalized.startsWith('/')) return normalized;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `http://${normalized}`;
}
