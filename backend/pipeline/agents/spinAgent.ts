'use strict';

/**
 * SPIN agent — Phase 2 of the build pipeline.
 *
 * Allocates host ports, runs docker compose up --build, and waits for
 * validationSpec.readyServices to reach running state.
 */

import type { BuildEventHandler, PortMap } from '../../types/domain';
import type { SpinFailureInput } from '../helpers/spinFailureLogs';

const composeManager = require('../../sandbox/composeManager');
const portAllocator = require('../../sandbox/portAllocator');
const { emitLog } = require('../build/buildLogger');
const {
  buildComposeUpMessage,
  captureContainerLogs,
  listFailingServiceNames,
} = require('../helpers/spinFailureLogs');

function cap(s: unknown, max: number): string | null | undefined {
  if (!s) return s as string | null | undefined;
  const str = typeof s === 'string' ? s : String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated ${str.length - max} chars]`;
}

/** Structured error thrown when compose up or service gating fails. */
class SpinError extends Error {
  evidence: SpinFailureInput;

  constructor(message: string, evidence: SpinFailureInput) {
    super(message);
    this.name = 'SpinError';
    this.evidence = evidence;
  }
}

/**
 * Run SPIN for one build iteration.
 * @returns Resolved HOST_PORT_* map for validation HTTP checks
 * @throws SpinError with typed failure evidence for repair
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
  let upSucceeded = false;

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

    if (readyServices?.length) {
      emitLog(onEvent, {
        level: 'info',
        tag: 'spin',
        message: `Gating on ${readyServices.length} ready service(s): ${readyServices.join(', ')}`,
      });
    }
    emitLog(onEvent, { level: 'info', tag: 'spin', message: 'Running docker compose up…' });
    await composeManager.up(buildDir, portMap);
    upSucceeded = true;

    await composeManager.waitForServices(buildDir, portMap, 90_000, readyServices);
    emitLog(onEvent, { level: 'ok', tag: 'spin', message: 'All services reported running' });

    return { portMap: portMap! };
  } catch (e) {
    const err = e as Record<string, unknown> & {
      message?: string;
      stdout?: string;
      stderr?: string;
      exitCode?: number | null;
    };

    let evidence: SpinFailureInput;

    if (!upSucceeded) {
      const stdout = err.stdout
        ? composeManager.stripDockerNoise(String(err.stdout))
        : null;
      const stderr = err.stderr
        ? composeManager.stripDockerNoise(String(err.stderr))
        : null;
      const containerLogs = await captureContainerLogs(buildDir, portMap).catch((): null => null);
      const message = buildComposeUpMessage(err.exitCode, stdout, stderr)
        || composeManager.stripDockerNoise(String(err.message || (e as Error).message || 'SPIN failed'));

      evidence = {
        failureKind: 'COMPOSE_UP',
        message,
        exitCode: err.exitCode ?? null,
        stdout,
        stderr,
        containerLogs: containerLogs
          ? composeManager.stripDockerNoise(containerLogs)
          : null,
      };
    } else {
      const message = composeManager.stripDockerNoise(
        String(err.message || (e as Error).message || 'SERVICE_RUNTIME failure'),
      );
      let psServices: Record<string, unknown>[] = [];
      try {
        psServices = await composeManager.listPsServices(buildDir, portMap!);
      } catch (_psErr) {
        psServices = [];
      }
      const failing = listFailingServiceNames(psServices);
      const containerLogs = await captureContainerLogs(buildDir, portMap, failing).catch((): null => null);

      evidence = {
        failureKind: 'SERVICE_RUNTIME',
        message,
        psServices,
        containerLogs: containerLogs
          ? composeManager.stripDockerNoise(containerLogs)
          : null,
      };
    }

    emitLog(onEvent, {
      level: 'error',
      tag: 'spin',
      message: `SPIN failed (${evidence.failureKind})`,
      detail: cap(evidence.message, 1500),
    });

    const previewSource = evidence.failureKind === 'COMPOSE_UP'
      ? joinPreview(evidence.stderr, evidence.stdout, evidence.containerLogs)
      : joinPreview(evidence.containerLogs, evidence.message);
    if (previewSource) {
      emitLog(onEvent, {
        level: 'detail',
        tag: 'spin',
        message: `SPIN log preview (${previewSource.length} bytes)`,
        detail: previewSource.split('\n').slice(0, 40).join('\n'),
      });
    }

    await composeManager.down(buildDir).catch(() => {});
    await portAllocator.releaseIn('build', buildSessionId).catch(() => {});

    throw new SpinError(evidence.message, evidence);
  }
}

function joinPreview(...parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p == null ? '' : String(p)).trim())
    .filter(Boolean)
    .join('\n');
}

module.exports = { spin, SpinError };
