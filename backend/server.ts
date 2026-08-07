'use strict';

import type { ExpressRequest, ExpressResponse, ExpressNextFunction } from './types/express';
import type { IncomingMessage } from 'http';
import type { Socket } from 'net';

require('dotenv').config({ override: true });

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const { runMigrations } = require('./db/migrate');
const { seedCatalogueIfEmpty } = require('./pipeline/catalogue/seeds/runCatalogueSeed');
const sessionStore = require('./db/sessionStore');
const draftStore = require('./pipeline/stores/problemDraftStore');
const { loadChallengesFromDB, seedChallengesFromDisk } = require('./challenges/loader');
const { seedManualCatalog } = require('./challenges/seedManualCatalog');
const { maybeArchiveLegacyChallengesAndPurgeDrafts } = require('./boot/maintenance');
const { VERIFIED_ROOT } = require('./sandbox/paths');

const contactRoutes = require('./routes/contact');
const authRoutes = require('./routes/auth');
const challengeRoutes = require('./routes/challenges');
const sessionRoutes = require('./routes/session');
const problemRoutes = require('./routes/problems');
const sparkAgentRoutes = require('./routes/sparkAgents');
const reviewRoutes = require('./routes/reviews');
const memoryRoutes = require('./routes/memories');
const devDbRoutes = require('./routes/devDb');

const terminalService = require('./observability/terminalService');
const metricsService = require('./observability/metricsService');
const agentObserverService = require('./observability/agentObserverService');

const PORT = parseInt(process.env.PORT || '4000', 10);

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use((req: ExpressRequest, _res: ExpressResponse, next: ExpressNextFunction) => {
  console.log(`[http] ${req.method} ${req.url}`);
  next();
});

app.get('/health', (_req: ExpressRequest, res: ExpressResponse) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/contact', contactRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/problems', problemRoutes);
app.use('/api/spark/agents', sparkAgentRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/memories', memoryRoutes);
app.use('/api/dev/db', devDbRoutes);

app.use((err: Error & { status?: number }, _req: ExpressRequest, res: ExpressResponse, _next: ExpressNextFunction) => {
  console.error('[http] unhandled error', err);
  res.status(err.status || 500).json({ error: err.message || 'internal error' });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
  let pathname: string;
  try {
    pathname = new URL(req.url || '', `http://${req.headers.host}`).pathname;
  } catch (_e) {
    socket.destroy();
    return;
  }

  const handlers: Record<string, (ws: unknown, req: IncomingMessage) => void> = {
    '/ws/terminal': terminalService.handleConnection,
    '/ws/metrics': metricsService.handleConnection,
    '/ws/agent-observer': agentObserverService.handleConnection,
  };

  const handler = handlers[pathname];
  if (!handler) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws: unknown) => {
    handler(ws, req);
  });
});

async function start(): Promise<void> {
  console.log('[boot] running migrations...');
  await runMigrations();

  try {
    const { cleanupSparkWorkspaces } = require('./workspace/cleanupSparkWorkspaces');
    console.log('[boot] consolidating spark workspaces (1 per user+challenge)...');
    await cleanupSparkWorkspaces();
  } catch (e: unknown) {
    console.warn('[boot] spark workspace cleanup skipped:', (e as Error).message);
  }

  const catalogueSeeded = await seedCatalogueIfEmpty({ onLog: (msg: string) => console.log(`[boot] ${msg}`) });
  if (catalogueSeeded > 0) console.log(`[boot] catalogue seeded ${catalogueSeeded} entries`);

  console.log('[boot] restoring active sessions from db...');
  await sessionStore.restoreFromDB();

  console.log('[boot] one-time legacy archive + draft purge (if needed)...');
  await maybeArchiveLegacyChallengesAndPurgeDrafts().catch((e: Error) => {
    console.warn('[boot] legacy maintenance failed:', e.message);
  });

  console.log('[boot] restoring draft sessions from db...');
  await draftStore.restoreFromDB().catch((e: Error) => console.warn('[boot] draftStore restore failed:', e.message));

  console.log('[boot] disk challenge seed (no-op under catalog v2)...');
  await seedChallengesFromDisk(VERIFIED_ROOT);

  console.log('[boot] seeding manual challenge catalog...');
  await seedManualCatalog();

  console.log('[boot] loading challenges from db...');
  await loadChallengesFromDB();

  server.listen(PORT, () => {
    console.log(`[boot] backend listening on http://localhost:${PORT}`);
  });
}

start().catch((err: Error) => {
  console.error('[boot] fatal error during startup', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('[boot] received SIGTERM, shutting down');
  server.close(() => process.exit(0));
});
