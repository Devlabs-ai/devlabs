'use strict';

const http = require('http');
const net = require('net');
const composeManager = require('./composeManager');
const sessionStore = require('../db/sessionStore');

const BROWSE_AGENT = new http.Agent({ keepAlive: false });
const RETRYABLE = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT']);
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 800;
const TCP_WAIT_MS = 4_000;

function serviceNameFromPortKey(key) {
  return key.replace(/^HOST_PORT_/, '').toLowerCase().replace(/_/g, '-');
}

function portForService(serviceName, portMap) {
  if (!portMap || !serviceName) return null;
  const norm = String(serviceName).toLowerCase();
  for (const [key, port] of Object.entries(portMap)) {
    if (serviceNameFromPortKey(key) === norm) return port;
  }
  return null;
}

function listBrowseServices(portMap) {
  return Object.keys(portMap || {}).map((key) => ({
    id: serviceNameFromPortKey(key),
    port: portMap[key],
    envKey: key,
  }));
}

function parseBrowsePath(originalUrl, sessionId, service) {
  const prefix = `/api/session/${sessionId}/browse/${service}`;
  const pathOnly = originalUrl.split('?')[0];
  let sub = pathOnly.startsWith(prefix) ? pathOnly.slice(prefix.length) : '';
  if (!sub || sub === '') sub = '/';
  if (!sub.startsWith('/')) sub = `/${sub}`;
  const q = originalUrl.includes('?') ? originalUrl.slice(originalUrl.indexOf('?')) : '';
  return sub + q;
}

function stripFrameBlockingHeaders(headers) {
  const out = { ...headers };
  delete out['x-frame-options'];
  delete out['content-security-policy'];
  delete out['content-security-policy-report-only'];
  delete out['cross-origin-opener-policy'];
  delete out['cross-origin-embedder-policy'];
  return out;
}

function browseBaseHref(baseHref) {
  return baseHref.endsWith('/') ? baseHref : `${baseHref}/`;
}

function injectBaseHref(html, baseHref) {
  const base = browseBaseHref(baseHref);
  if (/<base\s/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`);
  }
  return `<base href="${base}">${html}`;
}

/** Spark and similar UIs use href="/static/…" which ignores <base>; rewrite to proxy prefix. */
function rewriteRootAbsoluteUrls(html, baseHref) {
  const base = browseBaseHref(baseHref);
  let out = html;
  out = out.replace(
    /(\s(?:href|src|action)=["'])\/([^"'#?][^"']*)/gi,
    (_, attr, path) => `${attr}${base}${path}`,
  );
  out = out.replace(
    /(\s(?:href|src)=["'])\/(["'])/gi,
    (_, attr, close) => `${attr}${base}${close}`,
  );
  out = out.replace(/setUIRoot\(\s*['"]\s*['"]\s*\)/g, `setUIRoot('${base}')`);
  return out;
}

function rewriteHtmlForBrowse(html, baseHref) {
  return rewriteRootAbsoluteUrls(injectBaseHref(html, baseHref), baseHref);
}

function rewriteRedirectLocation(loc, port, baseHref) {
  if (!loc || typeof loc !== 'string') return loc;
  const base = browseBaseHref(baseHref);
  const localPrefix = `http://127.0.0.1:${port}`;
  if (loc.startsWith(localPrefix)) {
    return `${base}${loc.slice(localPrefix.length)}`;
  }
  if (loc.startsWith('/')) {
    return `${base}${loc.slice(1)}`;
  }
  return loc;
}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
]);

function forwardRequestHeaders(req, port, internalPort) {
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  out.host = `127.0.0.1:${internalPort || port}`;
  out['x-forwarded-host'] = req.headers.host || `127.0.0.1:${port}`;
  out['x-forwarded-proto'] = 'http';
  return out;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tcpPortOpen(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: timeoutMs }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForTcpPort(port, maxWaitMs = TCP_WAIT_MS) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await tcpPortOpen(port)) return true;
    await delay(800);
  }
  return false;
}

async function resolveBrowsePort(session, service) {
  const mapped = portForService(service, session.portMap);
  if (!mapped) return { port: null, internalPort: 80 };

  let port = parseInt(String(mapped), 10);
  let internalPort = 80;

  if (!session.buildDir) return { port, internalPort };

  try {
    const { content } = composeManager.readComposeFile(session.buildDir);
    internalPort = composeManager.containerPortForService(content, service);
    const live = await composeManager.getPort(session.buildDir, service, internalPort, {
      portMap: session.portMap,
    });
    if (live) port = live;
  } catch (e) {
    console.warn(`[browse] port resolve session=${session.id} service=${service}: ${e.message}`);
  }

  return { port, internalPort };
}

function proxyOnce({ port, internalPort, subPath, method, headers, baseHref }) {
  return new Promise((resolve, reject) => {
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port,
      path: subPath,
      method,
      headers,
      agent: BROWSE_AGENT,
      timeout: 30_000,
    }, (proxyRes) => {
      const ctype = String(proxyRes.headers['content-type'] || '');
      const shouldRewriteHtml = method === 'GET'
        && ctype.includes('text/html')
        && !subPath.includes('.');

      if (!shouldRewriteHtml) {
        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks);
          const outHeaders = stripFrameBlockingHeaders(proxyRes.headers);
          if (outHeaders.location) {
            outHeaders.location = rewriteRedirectLocation(outHeaders.location, port, baseHref);
          }
          resolve({
            statusCode: proxyRes.statusCode || 502,
            headers: outHeaders,
            body,
            raw: true,
          });
        });
        return;
      }

      const chunks = [];
      proxyRes.on('data', (c) => chunks.push(c));
      proxyRes.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8');
        try {
          body = rewriteHtmlForBrowse(body, baseHref);
        } catch (_e) { /* keep original */ }
        const outHeaders = stripFrameBlockingHeaders(proxyRes.headers);
        delete outHeaders['content-length'];
        resolve({
          statusCode: proxyRes.statusCode || 502,
          headers: { ...outHeaders, 'content-length': Buffer.byteLength(body) },
          body,
          raw: false,
        });
      });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      reject(Object.assign(new Error('sandbox service timed out'), { code: 'ETIMEDOUT' }));
    });

    proxyReq.on('error', reject);
    proxyReq.end();
  });
}

async function proxyWithRetry(opts) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await proxyOnce(opts);
    } catch (e) {
      lastErr = e;
      if (!RETRYABLE.has(e.code) || attempt === MAX_ATTEMPTS) break;
      console.warn(
        `[browse] retry ${attempt}/${MAX_ATTEMPTS} port=${opts.port} path=${opts.subPath}: ${e.message}`,
      );
      await delay(RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

async function handleBrowse(req, res) {
  const sessionId = req.params.id;
  const service = req.params.service;
  const session = sessionStore.get(sessionId);

  if (!session || session.status !== 'active' || !session.buildDir) {
    res.status(404).json({ error: 'session not found or sandbox not running' });
    return;
  }

  const { port, internalPort } = await resolveBrowsePort(session, service);
  if (!port) {
    res.status(404).json({ error: `no published port for service "${service}"` });
    return;
  }

  const subPath = parseBrowsePath(req.originalUrl, sessionId, service);
  const baseHref = `/api/session/${sessionId}/browse/${service}`;
  const headers = forwardRequestHeaders(req, port, internalPort);

  try {
    const out = await proxyWithRetry({
      port,
      internalPort,
      subPath,
      method: req.method,
      headers,
      baseHref,
    });
    if (out.raw) {
      res.writeHead(out.statusCode, out.headers);
      res.end(out.body);
    } else {
      res.writeHead(out.statusCode, out.headers);
      res.end(out.body);
    }
  } catch (err) {
    console.warn(`[browse] proxy error session=${sessionId} service=${service} port=${port}: ${err.message}`);
    if (!res.headersSent) {
      res.status(502).json({
        error: `sandbox service unreachable: ${err.message}`,
        hint: 'The UI may still be starting. Retry in a few seconds.',
        service,
        port,
      });
    }
  }
}

module.exports = {
  handleBrowse,
  portForService,
  listBrowseServices,
  serviceNameFromPortKey,
};
