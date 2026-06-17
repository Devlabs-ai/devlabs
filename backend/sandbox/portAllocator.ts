'use strict';

// Named port pools so the build pipeline and live interview sessions can't
// stomp on each other. Each pool is backed by its own Redis set
// (ports:used:<pool>) and an in-memory mirror for graceful Redis outages.

import type { PortMap } from '../types/domain';

const redis = require('../cache/redis');

interface PoolRange {
  min: number;
  max: number;
}

const POOLS: Record<string, PoolRange> = {
  session: { min: 7000, max: 7999 },
  build: { min: 6000, max: 6999 },
};

const memoryUsed: Record<string, Set<number>> = {
  session: new Set(),
  build: new Set(),
};

// sessionId/buildId -> { pool, ports: Map<field, port> }
const memoryByOwner = new Map<string, { pool: string; ports: Map<string, number> }>();

function poolOf(name: string): PoolRange {
  const p = POOLS[name];
  if (!p) throw new Error(`unknown port pool "${name}"`);
  return p;
}

async function isUsed(pool: string, port: number): Promise<boolean> {
  if (memoryUsed[pool].has(port)) return true;
  if (await redis.sHasPortIn(pool, port)) return true;
  return false;
}

async function reserve(pool: string, port: number, ownerId: string | null, field: string): Promise<void> {
  memoryUsed[pool].add(port);
  await redis.sAddPortIn(pool, port);
  if (ownerId) {
    if (!memoryByOwner.has(ownerId)) {
      memoryByOwner.set(ownerId, { pool, ports: new Map() });
    }
    memoryByOwner.get(ownerId)!.ports.set(field, port);
    await redis.hSetPort(ownerId, field, port);
  }
}

async function findFreePort(pool: string, ownerId: string | null, field: string): Promise<number> {
  const { min, max } = poolOf(pool);
  const start = min + Math.floor(Math.random() * (max - min + 1));
  for (let i = 0; i < (max - min + 1); i++) {
    const candidate = min + ((start - min + i) % (max - min + 1));
    // eslint-disable-next-line no-await-in-loop
    if (!(await isUsed(pool, candidate))) {
      // eslint-disable-next-line no-await-in-loop
      await reserve(pool, candidate, ownerId, field);
      return candidate;
    }
  }
  throw new Error(`no free ports available in pool "${pool}"`);
}

async function allocateNIn(pool: string, ownerId: string, fields: string[]): Promise<PortMap> {
  const result: PortMap = {};
  for (const field of fields) {
    // eslint-disable-next-line no-await-in-loop
    result[field] = await findFreePort(pool, ownerId, field);
  }
  return result;
}

// Back-compat: session lifecycle uses the unnamed allocateN(sessionId, fields).
async function allocateN(sessionId: string, fields: string[]): Promise<PortMap> {
  return allocateNIn('session', sessionId, fields);
}

async function releaseIn(pool: string, ownerId: string): Promise<void> {
  const fromMem = memoryByOwner.get(ownerId);
  const fromRedis: Record<string, string> = (await redis.hGetAllPorts(ownerId)) || {};

  const ports = new Set<number>();
  if (fromMem && fromMem.ports) {
    for (const p of fromMem.ports.values()) ports.add(Number(p));
  }
  for (const v of Object.values(fromRedis)) {
    ports.add(Number(v));
  }

  for (const p of ports) {
    memoryUsed[pool].delete(p);
    // eslint-disable-next-line no-await-in-loop
    await redis.sRemPortIn(pool, p);
    // Mirror to the legacy unnamed set so we never leak across restarts where
    // an older write may have landed in ports:used.
    // eslint-disable-next-line no-await-in-loop
    await redis.sRemPort(p);
  }

  memoryByOwner.delete(ownerId);
  await redis.hDelSessionPorts(ownerId);
}

async function release(sessionId: string): Promise<void> {
  return releaseIn('session', sessionId);
}

module.exports = {
  POOLS,
  allocate: async (sessionId: string): Promise<{ postgresPort: number; ordersPort: number }> => {
    const { POSTGRES_PORT, ORDERS_PORT } = await allocateN(sessionId, ['POSTGRES_PORT', 'ORDERS_PORT']) as Record<string, number>;
    return { postgresPort: POSTGRES_PORT, ordersPort: ORDERS_PORT };
  },
  allocateN,
  allocateNIn,
  release,
  releaseIn,
};
