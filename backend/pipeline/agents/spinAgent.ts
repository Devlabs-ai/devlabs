'use strict';

// Spin Agent — SPIN step of the build pipeline.

import type { BuildEventHandler, PortMap } from '../../types/domain';

const composeManager = require('../../sandbox/composeManager');
const portAllocator = require('../../sandbox/portAllocator');
const { emitLog } = require('../build/buildLogger');

function cap(s: unknown, max: number): string | null | undefined {
  if (!s) return s as string | null | undefined;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated ${str.length - max} chars]`;
}

async function captureComposeLogs(buildDir: string, portMap: PortMap | null | undefined): Promise<string> {
  try {
    const { stdout, stderr } = await composeManager.runCompose(
      ['logs', '--no-color', '--tail=200'],
      {
        cwd: buildDir,
        env: portMap
          ? Object.fromEntries(Object.entries(portMap).map(([k, v]) => [k, String(v)]))
          : {},
      },
    );
    return [stdout, stderr].filter(Boolean).join('\n');
  } catch (e) {
    const err = e as Record<string, unknown>;
    return [err.stdout, err.stderr, (e as Error).message].filter(Boolean).join('\n');
  }
}

class SpinError extends Error {
  composeStdout: string | null;
  composeStderr: string | null;
  logs: unknown;

  constructor(
    message: string,
    { composeStdout, composeStderr, logs }: {
      composeStdout?: string | null;
      composeStderr?: string | null;
      logs?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'SpinError';
    this.composeStdout = composeStdout || null;
    this.composeStderr = composeStderr || null;
    this.logs = logs || null;
  }
}

/**
 * Run the SPIN phase for one build iteration.
 * @returns {{ portMap: PortMap }} — resolved host-port environment map
 * @throws {SpinError} — structured failure
 */
async function spin({
  buildDir,
  buildSessionId,
  onEvent,
  readyServices = null,
}: {
  buildDir: string;
  buildSessionId: string;
  onEvent: BuildEventHandler;
  readyServices?: string[] | null;
}): Promise<{ portMap: PortMap }> {
  let portMap: PortMap | undefined;

  try {
    const { content: composeYaml } = composeManager.readComposeFile(buildDir);
    portMap = await composeManager.resolvePortMap(
      buildDir, composeYaml, buildSessionId, { pool: 'build' },
    );
    emitLog(onEvent, {
      level: 'info',
      tag: 'spin',
      message: 'Allocated host ports',
      detail: portMap,
    });

    if (readyServices && readyServices.length > 0) {
      emitLog(onEvent, {
        level: 'info',
        tag: 'spin',
        message: `Gating on ${readyServices.length} ready service(s): ${readyServices.join(', ')}`,
      });
    }
    emitLog(onEvent, { level: 'info', tag: 'spin', message: 'Running docker compose up…' });
    await composeManager.up(buildDir, portMap);

    await composeManager.waitForServices(buildDir, portMap, 90_000, readyServices);
    emitLog(onEvent, { level: 'ok', tag: 'spin', message: 'All services reported running' });

    return { portMap: portMap! };
  } catch (e) {
    const err = e as Record<string, unknown> & { message?: string };
    const cleanMsg = composeManager.stripDockerNoise(err.message || '');
    const cleanStderr = composeManager.stripDockerNoise(String(err.stderr || ''));
    const cleanStdout = composeManager.stripDockerNoise(String(err.stdout || ''));

    emitLog(onEvent, {
      level: 'error',
      tag: 'spin',
      message: 'Compose spin failed',
      detail: cap(cleanMsg, 1500),
    });

    if (cleanStderr) {
      emitLog(onEvent, {
        level: 'detail',
        tag: 'spin',
        message: 'Compose stderr',
        detail: cap(cleanStderr, 1500),
      });
    }

    const rawLogs = await captureComposeLogs(buildDir, portMap).catch((): null => null);
    const logs = rawLogs ? composeManager.stripDockerNoise(rawLogs) : null;
    if (logs) {
      const head = logs.split('\n').slice(0, 40).join('\n');
      emitLog(onEvent, {
        level: 'detail',
        tag: 'spin',
        message: `Container logs (${logs.length} bytes captured)`,
        detail: head,
      });
    }

    await composeManager.down(buildDir).catch(() => {});
    await portAllocator.releaseIn('build', buildSessionId).catch(() => {});

    throw new SpinError(cleanMsg || (e as Error).message, {
      composeStdout: cleanStdout || null,
      composeStderr: cleanStderr || null,
      logs,
    });
  }
}

module.exports = { spin, SpinError };
