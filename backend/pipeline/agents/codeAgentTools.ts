'use strict';

/**
 * Sandbox file tools for the CODE agent (list / read / write / edit / grep).
 * All paths are confined to the build workspace under sandbox/builds/<id>/.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { BuildEventHandler } from '../../types/domain';

const { tool } = require('ai');
const { z } = require('zod');

const MAX_LIST_ENTRIES = 200;
const MAX_READ_CHARS = 8000;
const MAX_WRITE_CHARS = 65536;
const MAX_GREP_MATCHES = 50;

/** Reject path traversal and absolute paths; return a normalized relative path. */
export function safeRel(rel: unknown): string | null {
  if (!rel || typeof rel !== 'string') return null;
  if (rel.includes('..')) return null;
  if (path.isAbsolute(rel)) return null;
  return rel.replace(/^\/+/, '');
}

/** Resolve a relative tool path to an absolute path inside buildDir, or null if outside. */
function resolveInWorkspace(buildDir: string, relPath: string): string | null {
  const rel = safeRel(relPath);
  if (!rel) return null;
  const abs = path.resolve(buildDir, rel);
  const root = path.resolve(buildDir);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return null;
  return abs;
}

/** Allowed write targets: compose, challenge manifest, services/*, flat init/* files. */
function isWritablePath(relPath: string): boolean {
  const rel = safeRel(relPath);
  if (!rel) return false;
  if (rel === 'docker-compose.yml' || rel === 'challenge.json') return true;
  if (rel.startsWith('services/')) return true;
  if (rel.startsWith('init/')) {
    const inside = rel.slice('init/'.length);
    return !!inside && !inside.includes('/');
  }
  return false;
}

/** Truncate long tool output returned to the LLM. */
function capOutput(s: string, max = MAX_READ_CHARS): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

/** Walk a directory tree and collect file paths with byte sizes (capped). */
function listFilesRecursive(dir: string, prefix: string, out: Array<{ path: string; bytes: number }>): void {
  if (out.length >= MAX_LIST_ENTRIES || !fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (out.length >= MAX_LIST_ENTRIES) break;
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) listFilesRecursive(abs, rel, out);
    else if (st.isFile()) out.push({ path: rel, bytes: st.size });
  }
}

export interface ToolContext {
  buildDir: string;
  onEvent?: BuildEventHandler;
}

/**
 * Build the tool set passed to the CODE agent LLM loop.
 * Tool I/O logging is handled by agentRuntime.runAgentWithTools — not here.
 */
export function createCodeAgentTools(ctx: ToolContext): Record<string, ReturnType<typeof tool>> {
  return {
    list_files: tool({
      description: 'List files under the build workspace with byte sizes.',
      inputSchema: z.object({
        subpath: z.string().optional().describe('Optional subdirectory, e.g. services/order-service'),
      }),
      execute: async ({ subpath }: { subpath?: string }) => {
        const root = subpath ? resolveInWorkspace(ctx.buildDir, subpath) : ctx.buildDir;
        if (!root || !fs.existsSync(root)) {
          return { ok: false, error: 'path not found or not allowed' };
        }
        const prefix = subpath ? safeRel(subpath) || '' : '';
        const entries: Array<{ path: string; bytes: number }> = [];
        if (fs.statSync(root).isFile()) {
          entries.push({ path: prefix, bytes: fs.statSync(root).size });
        } else {
          listFilesRecursive(root, prefix, entries);
        }
        return { ok: true, files: entries };
      },
    }),

    read_file: tool({
      description: 'Read a file from the build workspace. Optionally limit to a line range.',
      inputSchema: z.object({
        path: z.string(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      }),
      execute: async ({ path: relPath, startLine, endLine }: {
        path: string;
        startLine?: number;
        endLine?: number;
      }) => {
        const abs = resolveInWorkspace(ctx.buildDir, relPath);
        if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          return { ok: false, error: 'file not found or not allowed' };
        }
        let content = fs.readFileSync(abs, 'utf8');
        if (startLine || endLine) {
          const lines = content.split('\n');
          const start = Math.max(1, startLine || 1);
          const end = Math.min(lines.length, endLine || lines.length);
          content = lines.slice(start - 1, end).join('\n');
        }
        return { ok: true, path: relPath, content: capOutput(content) };
      },
    }),

    write_file: tool({
      description: 'Create or fully replace a file in the build workspace.',
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path: relPath, content }: { path: string; content: string }) => {
        if (!isWritablePath(relPath)) {
          return { ok: false, error: 'path not writable — use services/*, init/*, docker-compose.yml, or challenge.json' };
        }
        if (content.length > MAX_WRITE_CHARS) {
          return { ok: false, error: `content exceeds ${MAX_WRITE_CHARS} char limit` };
        }
        const abs = resolveInWorkspace(ctx.buildDir, relPath);
        if (!abs) return { ok: false, error: 'invalid path' };
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
        return { ok: true, path: relPath, bytes: content.length };
      },
    }),

    write_files: tool({
      description:
        'Create or replace multiple files in one call. Preferred for scaffold — pass docker-compose.yml, challenge.json, service Dockerfiles/code, and init scripts together.',
      inputSchema: z.object({
        files: z
          .array(z.object({ path: z.string(), content: z.string() }))
          .min(1)
          .max(24)
          .describe('Files to write, each with path and full content'),
      }),
      execute: async ({ files }: { files: Array<{ path: string; content: string }> }) => {
        const written: Array<{ path: string; bytes: number }> = [];
        const errors: string[] = [];
        let totalChars = 0;
        for (const file of files) {
          totalChars += file.content.length;
          if (totalChars > MAX_WRITE_CHARS * 24) {
            errors.push('batch exceeds total size limit');
            break;
          }
          if (!isWritablePath(file.path)) {
            errors.push(`${file.path}: not writable`);
            continue;
          }
          if (file.content.length > MAX_WRITE_CHARS) {
            errors.push(`${file.path}: exceeds ${MAX_WRITE_CHARS} char limit`);
            continue;
          }
          const abs = resolveInWorkspace(ctx.buildDir, file.path);
          if (!abs) {
            errors.push(`${file.path}: invalid path`);
            continue;
          }
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, file.content);
          written.push({ path: file.path, bytes: file.content.length });
        }
        return {
          ok: errors.length === 0,
          written,
          errors: errors.length ? errors : undefined,
          count: written.length,
        };
      },
    }),

    edit_file: tool({
      description: 'Replace one unique occurrence in a file (surgical patch).',
      inputSchema: z.object({
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
      }),
      execute: async ({ path: relPath, old_string, new_string }: {
        path: string;
        old_string: string;
        new_string: string;
      }) => {
        if (!isWritablePath(relPath)) return { ok: false, error: 'path not writable' };
        const abs = resolveInWorkspace(ctx.buildDir, relPath);
        if (!abs || !fs.existsSync(abs)) return { ok: false, error: 'file not found' };
        const content = fs.readFileSync(abs, 'utf8');
        const count = content.split(old_string).length - 1;
        if (count === 0) {
          return { ok: false, error: 'old_string not found — use read_file first, or write_file for full replace' };
        }
        if (count > 1) {
          return { ok: false, error: `old_string matches ${count} times — provide more context` };
        }
        const updated = content.replace(old_string, new_string);
        if (updated.length > MAX_WRITE_CHARS) {
          return { ok: false, error: `result exceeds ${MAX_WRITE_CHARS} char limit — use write_file` };
        }
        fs.writeFileSync(abs, updated);
        return { ok: true, path: relPath, bytes: updated.length };
      },
    }),

    grep: tool({
      description: 'Search for a literal string pattern in workspace files.',
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().optional().describe('Optional subdirectory or file to search'),
      }),
      execute: async ({ pattern, path: subpath }: { pattern: string; path?: string }) => {
        const root = subpath ? resolveInWorkspace(ctx.buildDir, subpath) : ctx.buildDir;
        if (!root || !fs.existsSync(root)) return { ok: false, error: 'path not found' };
        const matches: Array<{ path: string; line: number; text: string }> = [];
        const walk = (dir: string, prefix: string): void => {
          if (matches.length >= MAX_GREP_MATCHES) return;
          for (const name of fs.readdirSync(dir)) {
            if (matches.length >= MAX_GREP_MATCHES) break;
            const abs = path.join(dir, name);
            const rel = prefix ? `${prefix}/${name}` : name;
            const st = fs.statSync(abs);
            if (st.isDirectory()) walk(abs, rel);
            else if (st.isFile() && st.size < 512000) {
              const lines = fs.readFileSync(abs, 'utf8').split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(pattern)) {
                  matches.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, 200) });
                  if (matches.length >= MAX_GREP_MATCHES) break;
                }
              }
            }
          }
        };
        if (fs.statSync(root).isFile()) {
          const lines = fs.readFileSync(root, 'utf8').split('\n');
          const rel = subpath ? safeRel(subpath) || '' : '';
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(pattern)) {
              matches.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, 200) });
            }
          }
        } else {
          walk(root, subpath ? safeRel(subpath) || '' : '');
        }
        return { ok: true, matches };
      },
    }),
  };

  /*
   * Code-chunk tools disabled for now (repair-time semantic index + search_code).
   *
   * const codeChunkStore = require('../stores/codeChunkStore');
   *
   * async function afterMutation(ctx: ToolContext, relPath: string): Promise<void> {
   *   await codeChunkStore.indexPaths({
   *     buildSessionId: ctx.buildSessionId,
   *     draftSessionId: ctx.draftSessionId,
   *     attempt: ctx.attempt,
   *     buildDir: ctx.buildDir,
   *     paths: [relPath],
   *   });
   * }
   *
   * search_code: tool({
   *   description: 'Semantic search over indexed code chunks in this build.',
   *   inputSchema: z.object({ query: z.string() }),
   *   execute: async ({ query }) => {
   *     const hits = await codeChunkStore.search({
   *       draftSessionId: ctx.draftSessionId,
   *       buildSessionId: ctx.buildSessionId,
   *       query,
   *     });
   *     return { ok: true, hits };
   *   },
   * }),
   */
}

module.exports = {
  safeRel,
  createCodeAgentTools,
  MAX_READ_CHARS,
  MAX_WRITE_CHARS,
};
