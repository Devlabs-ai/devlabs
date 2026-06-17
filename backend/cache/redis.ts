'use strict';

import type { Redis as RedisClient } from 'ioredis';

const Redis = require('ioredis');

const RUNTIME_TTL_S = 4 * 60 * 60;
const BUILD_TTL_S = 24 * 60 * 60;

let client: RedisClient | null = null;
let healthy = false;

function init(): RedisClient {
  if (client) return client;

  const opts = {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy(times: number): number | null {
      if (times > 10) return null;
      return Math.min(times * 200, 3000);
    },
  };

  if (process.env.REDIS_URL) {
    client = new Redis(process.env.REDIS_URL, opts) as RedisClient;
  } else {
    client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      ...opts,
    }) as RedisClient;
  }

  client.on('ready', () => {
    healthy = true;
    console.log('[redis] connected');
  });

  client.on('error', (err: Error) => {
    if (healthy) console.warn('[redis] error:', err.message);
    healthy = false;
  });

  client.on('end', () => {
    healthy = false;
  });

  client.connect().catch((err: Error) => {
    console.warn('[redis] initial connect failed, continuing without cache:', err.message);
  });

  return client;
}

init();

function isReady(): boolean {
  return !!client && (client.status === 'ready' || healthy);
}

async function safe<T>(op: () => Promise<T>): Promise<T | null> {
  if (!isReady()) return null;
  try {
    return await op();
  } catch (e: unknown) {
    console.warn('[redis] op failed:', (e as Error).message);
    return null;
  }
}

async function setRuntime(sessionId: string, blob: unknown): Promise<string | null> {
  return safe(() =>
    client!.set(`session:runtime:${sessionId}`, JSON.stringify(blob), 'EX', RUNTIME_TTL_S),
  );
}

async function getRuntime(sessionId: string): Promise<unknown> {
  const raw = await safe(() => client!.get(`session:runtime:${sessionId}`));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

async function delRuntime(sessionId: string): Promise<number | null> {
  return safe(() => client!.del(`session:runtime:${sessionId}`));
}

async function sAddPort(port: number | string): Promise<number | null> {
  return safe(() => client!.sadd('ports:used', String(port)));
}

async function sRemPort(port: number | string): Promise<number | null> {
  return safe(() => client!.srem('ports:used', String(port)));
}

async function sHasPort(port: number | string): Promise<boolean> {
  const r = await safe(() => client!.sismember('ports:used', String(port)));
  return r === 1;
}

async function hSetPort(sessionId: string, field: string, port: number | string): Promise<void> {
  await safe(() => client!.hset(`ports:allocated:${sessionId}`, field, String(port)));
  await safe(() => client!.expire(`ports:allocated:${sessionId}`, BUILD_TTL_S));
}

async function hGetAllPorts(sessionId: string): Promise<Record<string, string> | null> {
  return safe(() => client!.hgetall(`ports:allocated:${sessionId}`));
}

async function hDelSessionPorts(sessionId: string): Promise<number | null> {
  return safe(() => client!.del(`ports:allocated:${sessionId}`));
}

// --- named port pool helpers (build vs session isolation) -----------------

async function sAddPortIn(pool: string, port: number | string): Promise<number | null> {
  return safe(() => client!.sadd(`ports:used:${pool}`, String(port)));
}

async function sRemPortIn(pool: string, port: number | string): Promise<number | null> {
  return safe(() => client!.srem(`ports:used:${pool}`, String(port)));
}

async function sHasPortIn(pool: string, port: number | string): Promise<boolean> {
  const r = await safe(() => client!.sismember(`ports:used:${pool}`, String(port)));
  return r === 1;
}

// --- build pipeline helpers ----------------------------------------------

async function setBuildStatus(buildId: string, status: string): Promise<string | null> {
  return safe(() => client!.set(`build:status:${buildId}`, status, 'EX', BUILD_TTL_S));
}

async function getBuildStatus(buildId: string): Promise<string | null> {
  return safe(() => client!.get(`build:status:${buildId}`));
}

async function setBuildPhase(buildId: string, phase: string): Promise<string | null> {
  return safe(() => client!.set(`build:phase:${buildId}`, phase, 'EX', BUILD_TTL_S));
}

async function getBuildPhase(buildId: string): Promise<string | null> {
  return safe(() => client!.get(`build:phase:${buildId}`));
}

async function setBuildAttempt(buildId: string, attempt: number): Promise<string | null> {
  return safe(() => client!.set(`build:attempt:${buildId}`, String(attempt), 'EX', BUILD_TTL_S));
}

async function getBuildAttempt(buildId: string): Promise<number | null> {
  const v = await safe(() => client!.get(`build:attempt:${buildId}`));
  return v ? parseInt(v, 10) : null;
}

async function setBuildDir(buildId: string, dir: string): Promise<string | null> {
  return safe(() => client!.set(`build:dir:${buildId}`, dir, 'EX', BUILD_TTL_S));
}

async function getBuildDir(buildId: string): Promise<string | null> {
  return safe(() => client!.get(`build:dir:${buildId}`));
}

async function pushBuildLog(buildId: string, line: string): Promise<void> {
  await safe(() => client!.rpush(`build:logs:${buildId}`, line));
  await safe(() => client!.expire(`build:logs:${buildId}`, BUILD_TTL_S));
}

async function getBuildLogs(buildId: string, start = 0, end = -1): Promise<string[] | null> {
  return safe(() => client!.lrange(`build:logs:${buildId}`, start, end));
}

module.exports = {
  client: (): RedisClient | null => client,
  isReady,
  setRuntime,
  getRuntime,
  delRuntime,
  sAddPort,
  sRemPort,
  sHasPort,
  sAddPortIn,
  sRemPortIn,
  sHasPortIn,
  hSetPort,
  hGetAllPorts,
  hDelSessionPorts,
  setBuildStatus,
  getBuildStatus,
  setBuildPhase,
  getBuildPhase,
  setBuildAttempt,
  getBuildAttempt,
  setBuildDir,
  getBuildDir,
  pushBuildLog,
  getBuildLogs,
};
