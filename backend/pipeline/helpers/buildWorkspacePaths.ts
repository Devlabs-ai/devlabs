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
  const filePath = toolFilePath(input);
  if (!filePath) {
    if (toolName === 'Glob' || toolName === 'Grep') {
      const searchPath = typeof input.path === 'string' ? input.path.trim() : '';
      if (!searchPath) return { allowed: true, resolved: null, reason: null };
      const resolved = resolveWorkspacePath(buildDir, searchPath);
      if (!isInsideBuildDir(buildDir, resolved)) {
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

  const resolved = resolveWorkspacePath(buildDir, filePath);
  if (!isInsideBuildDir(buildDir, resolved)) {
    return {
      allowed: false,
      resolved,
      reason: [
        `${toolName} path "${filePath}" is outside the build workspace.`,
        `Write only under workspaceRoot from the user payload (e.g. ${path.join(buildDir, 'docker-compose.yml')}).`,
        'Never use /tmp, /work, /build, or other directories.',
      ].join(' '),
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
  return {
    buildDir: root,
    workspaceRoot: root,
    workspaceNote:
      'All Read/Write/Edit file_path values must resolve inside workspaceRoot. '
      + 'Use absolute paths under workspaceRoot (e.g. '
      + `${path.join(root, 'docker-compose.yml')}) or paths relative to it (e.g. docker-compose.yml). `
      + 'The server rejects paths outside workspaceRoot.',
  };
}

module.exports = {
  toolFilePath,
  resolveWorkspacePath,
  isInsideBuildDir,
  validateWorkspaceToolPath,
  workspacePayloadFields,
};
