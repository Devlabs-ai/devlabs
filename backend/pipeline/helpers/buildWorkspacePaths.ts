'use strict';

import * as path from 'path';

const PATH_TOOLS = new Set(['Read', 'Write', 'Edit']);

/** Extract file_path / path from Claude Code tool input. */
export function toolFilePath(input: Record<string, unknown>): string | null {
  const p = input.file_path ?? input.path;
  return typeof p === 'string' && p.trim() ? p.trim() : null;
}

/** Resolve a tool path against the build workspace root. */
export function resolveWorkspacePath(buildDir: string, filePath: string): string {
  const root = path.resolve(buildDir);
  return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
}

/** True when resolved path is buildDir or a descendant. */
export function isInsideBuildDir(buildDir: string, absPath: string): boolean {
  const root = path.resolve(buildDir);
  const resolved = path.resolve(absPath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

/**
 * When cwd is .../gen and the model writes gen/generate.py, collapse to .../gen/generate.py
 * (same for any workspace whose basename is repeated as a child folder).
 */
export function collapseDuplicateBasename(buildDir: string, absPath: string): string {
  const root = path.resolve(buildDir);
  const resolved = path.resolve(absPath);
  const base = path.basename(root);
  if (!base || base === '.' || base === path.sep) return resolved;
  const dupRoot = path.join(root, base);
  if (resolved === dupRoot || resolved.startsWith(`${dupRoot}${path.sep}`)) {
    const rest = path.relative(dupRoot, resolved);
    return path.join(root, rest === '' ? '.' : rest);
  }
  // Also collapse relative inputs like "gen/foo" before resolve when cwd basename is gen
  return resolved;
}

/**
 * Strip a leading "<basename>/" from relative paths when cwd already ends with that basename.
 * e.g. buildDir=.../gen + "gen/generate.py" → "generate.py"
 */
export function stripRedundantRelativePrefix(buildDir: string, filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  const base = path.basename(path.resolve(buildDir));
  const norm = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (norm === base) return '.';
  if (norm.startsWith(`${base}/`)) return norm.slice(base.length + 1);
  return filePath;
}

export interface WorkspacePathValidation {
  allowed: boolean;
  resolved: string | null;
  reason: string | null;
  normalizedInput?: Record<string, unknown>;
}

/**
 * Gate Read/Write/Edit (and optional Glob/Grep path) to the build workspace.
 * Normalizes allowed file paths to absolute paths under buildDir (SDK Write expects absolute).
 */
export function validateWorkspaceToolPath(
  buildDir: string,
  toolName: string,
  input: Record<string, unknown>,
): WorkspacePathValidation {
  const root = path.resolve(buildDir);
  let filePath = toolFilePath(input);
  if (!filePath) {
    if (toolName === 'Glob' || toolName === 'Grep') {
      const searchPath = typeof input.path === 'string' ? input.path.trim() : '';
      if (!searchPath) return { allowed: true, resolved: null, reason: null };
      const stripped = stripRedundantRelativePrefix(root, searchPath);
      const resolved = collapseDuplicateBasename(root, resolveWorkspacePath(root, stripped));
      if (!isInsideBuildDir(root, resolved)) {
        return {
          allowed: false,
          resolved,
          reason: `${toolName} search path "${searchPath}" is outside the build workspace. Search only under workspaceRoot from the user payload.`,
        };
      }
      return {
        allowed: true,
        resolved,
        reason: null,
        normalizedInput: { ...input, path: resolved },
      };
    }
    if (PATH_TOOLS.has(toolName)) {
      return { allowed: false, resolved: null, reason: `${toolName} requires file_path inside the build workspace.` };
    }
    return { allowed: true, resolved: null, reason: null };
  }

  // Reject obvious non-workspace roots early (even before resolve tricks)
  if (/^\/(tmp|var\/tmp|private\/tmp|work|root)\b/i.test(filePath)
    || /^\/tmp\//i.test(filePath)
    || filePath.startsWith('/tmp/')
    || filePath.startsWith('/var/tmp/')
    || filePath.startsWith('/work/')
    || filePath.startsWith('/root/')) {
    return {
      allowed: false,
      resolved: null,
      reason: [
        `${toolName} path "${filePath}" is outside the build workspace.`,
        `Write only under ${root} (e.g. generate.py or ${path.join(root, 'generate.py')}).`,
        'Never use /tmp, /work, /root, or other absolute directories.',
      ].join(' '),
    };
  }

  const stripped = stripRedundantRelativePrefix(root, filePath);
  let resolved = collapseDuplicateBasename(root, resolveWorkspacePath(root, stripped));

  if (!isInsideBuildDir(root, resolved)) {
    return {
      allowed: false,
      resolved,
      reason: [
        `${toolName} path "${filePath}" is outside the build workspace.`,
        `Write only under workspaceRoot (e.g. ${path.join(root, 'generate.py')}).`,
        'Never use /tmp, /work, /build, or other directories.',
      ].join(' '),
    };
  }

  // Block nested basename folder (gen/gen) and junk
  const rel = path.relative(root, resolved).replace(/\\/g, '/');
  const base = path.basename(root);
  if (rel === base || rel.startsWith(`${base}/`)) {
    resolved = path.join(root, rel.slice(base.length).replace(/^\//, '') || '.');
  }
  if (rel.includes('__pycache__') || rel.endsWith('.pyc')) {
    return {
      allowed: false,
      resolved,
      reason: `${toolName} must not write __pycache__ / .pyc under the workspace.`,
    };
  }

  if (PATH_TOOLS.has(toolName)) {
    return {
      allowed: true,
      resolved,
      reason: null,
      normalizedInput: { ...input, file_path: resolved },
    };
  }

  return { allowed: true, resolved, reason: null };
}

/** Fields injected into CODE agent user JSON so the model knows where to write. */
export function workspacePayloadFields(buildDir: string): Record<string, string> {
  const root = path.resolve(buildDir);
  const base = path.basename(root);
  return {
    buildDir: root,
    workspaceRoot: root,
    workspaceNote:
      'All Read/Write/Edit file_path values must resolve inside workspaceRoot. '
      + `cwd already IS the workspace (${base}/). `
      + `Write "${base === 'gen' ? 'generate.py' : 'relative/path'}" — NOT "${base}/…". `
      + 'Use absolute paths under workspaceRoot or short relative names. '
      + 'The server rejects /tmp and paths outside workspaceRoot, and collapses accidental '
      + `${base}/${base}/ nesting.`,
  };
}

module.exports = {
  toolFilePath,
  resolveWorkspacePath,
  isInsideBuildDir,
  collapseDuplicateBasename,
  stripRedundantRelativePrefix,
  validateWorkspaceToolPath,
  workspacePayloadFields,
};
