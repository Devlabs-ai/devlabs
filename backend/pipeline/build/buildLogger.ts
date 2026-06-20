'use strict';

import type { BuildEventHandler } from '../../types/domain';

/**
 * Emit a structured log event through the pipeline onEvent callback.
 */
function emitLog(
  onEvent: BuildEventHandler,
  opts: { level?: string; tag?: string; message: string; detail?: unknown },
): void {
  if (typeof onEvent !== 'function') return;
  const detail = opts.detail != null
    ? (typeof opts.detail === 'string' ? opts.detail : JSON.stringify(opts.detail))
    : undefined;
  onEvent({
    type: 'log',
    level: opts.level || 'info',
    tag: opts.tag || 'build',
    message: opts.message,
    ...(detail !== undefined && { detail }),
  });
}

module.exports = { emitLog };
