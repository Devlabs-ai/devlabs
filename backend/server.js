'use strict';

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
const { VERIFIED_ROOT } = require('./sandbox/paths');

const { ensurePublicLibrary } = require('./auth/companyStore');
const contactRoutes = require('./routes/contact');
const authRoutes = require('./routes/auth');
const challengeRoutes = require('./routes/challenges');
const sessionRoutes = require('./routes/session');
const problemRoutes = require('./routes/problems');
const reviewRoutes = require('./routes/reviews');
const memoryRoutes = require('./routes/memories');

const terminalService = require('./observability/terminalService');
const metricsService = require('./observability/metricsService');
const agentObserverService = require('./observability/agentObserverService');

const PORT = parseInt(process.env.PORT || '4000', 10);

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use((req, _res, next) => {
  console.log(`[http] ${req.method} ${req.url}`);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/contact', contactRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/problems', problemRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/memories', memoryRoutes);

app.use((err, _req, res, _next) => {
  console.error('[http] unhandled error', err);
  res.status(err.status || 500).json({ error: err.message || 'internal error' });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  } catch (_e) {
    socket.destroy();
    return;
  }

  const handlers = {
    '/ws/terminal': terminalService.handleConnection,
    '/ws/metrics': metricsService.handleConnection,
    '/ws/agent-observer': agentObserverService.handleConnection,
  };

  const handler = handlers[pathname];
  if (!handler) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    handler(ws, req);
  });
});

async function start() {
  console.log('[boot] running migrations...');
  await runMigrations();

  const catalogueSeeded = await seedCatalogueIfEmpty({ onLog: (msg) => console.log(`[boot] ${msg}`) });
  if (catalogueSeeded > 0) console.log(`[boot] catalogue seeded ${catalogueSeeded} entries`);

  console.log('[boot] restoring active sessions from db...');
  await sessionStore.restoreFromDB();

  console.log('[boot] restoring draft sessions from db...');
  await draftStore.restoreFromDB().catch((e) => console.warn('[boot] draftStore restore failed:', e.message));

  console.log(`[boot] seeding challenges from ${VERIFIED_ROOT}`);
  await seedChallengesFromDisk(VERIFIED_ROOT);

  console.log('[boot] ensuring public library exists...');
  await ensurePublicLibrary().catch((e) => console.warn('[boot] ensurePublicLibrary failed:', e.message));

  console.log('[boot] loading challenges from db...');
  await loadChallengesFromDB();

  server.listen(PORT, () => {
    console.log(`[boot] backend listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[boot] fatal error during startup', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('[boot] received SIGTERM, shutting down');
  server.close(() => process.exit(0));
});
