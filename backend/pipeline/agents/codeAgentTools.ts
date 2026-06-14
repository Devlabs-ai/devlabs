'use strict';

import * as fs from 'fs';
import * as path from 'path';

import type { BuildEventHandler } from '../../types/domain';

const { tool } = require('ai');
const { z } = require('zod');
const codeChunkStore = require('../stores/codeChunkStore');

const MAX_LIST_ENTRIES = 200;
const MAX_READ_CHARS = 8000;
const MAX_WRITE_CHARS = 65536;
const MAX_GREP_MATCHES = 50;

export function safeRel(rel: unknown): string | null {
  if (!rel || typeof rel !== 'string') return null;
  if (rel.includes('..')) return null;
  if (path.isAbsolute(rel)) return null;
  return rel.replace(/^\/+/, '');
}

function resolveInWorkspace(buildDir: string, relPath: string): string | null {
  const rel = safeRel(relPath);
  if (!rel) return null;
  const abs = path.resolve(buildDir, rel);
  const root = path.resolve(buildDir);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return null;
  return abs;
}

function isWritablePath(relPath: string): boolean {
  const rel = safeRel(relPath);
  if (!rel) return false;
  if (rel === 'docker-compose.yml' || rel === 'challenge.json') return true;
  if (rel.startsWith('services/')) return true;
  if (rel.startsWith('init/')) {
    const inside = rel.slice('init/'.length);
    if (!inside || inside.includes('/')) return false;
    return true;
  }
  return false;
}

function capOutput(s: string, max = MAX_READ_CHARS): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

function listFilesRecursive(dir: string, prefix: string, out: Array<{ path: string; bytes: number }>): void {
  if (out.length >= MAX_LIST_ENTRIES) return;
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (out.length >= MAX_LIST_ENTRIES) break;
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      listFilesRecursive(abs, rel, out);
    } else if (st.isFile()) {
      out.push({ path: rel, bytes: st.size });
    }
  }
}

export interface ToolContext {
  buildDir: string;
  buildSessionId: string;
  draftSessionId?: string | null;
  attempt: number;
  onEvent?: BuildEventHandler;
  onPathsChanged?: (paths: string[]) => void;
}

function emitToolEvent(ctx: ToolContext, payload: Record<string, unknown>): void {
  ctx.onEvent?.({ type: 'tool', ...payload } as never);
}

function formatToolArgSummary(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const a = input as Record<string, unknown>;
  if (toolName === 'write_file') return `path=${a.path}, bytes=${String(a.content || '').length}`;
  if (toolName === 'edit_file') return `path=${a.path}`;
  if (toolName === 'read_file') return `path=${a.path}`;
  if (toolName === 'grep') return `pattern=${JSON.stringify(a.pattern)}`;
  if (toolName === 'search_code') return `query=${JSON.stringify(String(a.query || '').slice(0, 80))}`;
  if (toolName === 'list_files') return a.subpath ? `subpath=${a.subpath}` : '(root)';
  return '';
}

function logToolActivity(ctx: ToolContext, message: string): void {
  ctx.onEvent?.({ type: 'log', level: 'info', tag: 'code', message } as never);
  console.log(`[code] ${message}`);
}

function wrapToolExecute<T>(
  ctx: ToolContext,
  toolName: string,
  fn: (input: T) => Promise<unknown>,
): (input: T) => Promise<unknown> {
  return async (input: T) => {
    const t0 = Date.now();
    const argSummary = formatToolArgSummary(toolName, input);
    logToolActivity(ctx, `→ ${toolName}${argSummary ? `(${argSummary})` : ''}`);
    try {
      const result = await fn(input);
      const ms = Date.now() - t0;
      const out = result as Record<string, unknown> | null;
      const extra = out?.error
        ? `error=${out.error}`
        : (out?.bytes != null ? `bytes=${out.bytes}` : (Array.isArray(out?.files) ? `files=${out.files.length}` : (Array.isArray(out?.matches) ? `matches=${out.matches.length}` : (Array.isArray(out?.hits) ? `hits=${out.hits.length}` : ''))));
      logToolActivity(ctx, `← ${toolName} ${ms}ms${extra ? ` — ${extra}` : ''}`);
      return result;
    } catch (e) {
      logToolActivity(ctx, `← ${toolName} failed ${Date.now() - t0}ms — ${(e as Error).message}`);
      throw e;
    }
  };
}

async function afterMutation(ctx: ToolContext, relPath: string): Promise<void> {
  const rel = safeRel(relPath);
  if (!rel) return;
  try {
    await codeChunkStore.indexPaths({
      buildSessionId: ctx.buildSessionId,
      draftSessionId: ctx.draftSessionId,
      attempt: ctx.attempt,
      buildDir: ctx.buildDir,
      paths: [rel],
    });
  } catch (e) {
    console.warn(`[codeTools] re-index ${rel} failed: ${(e as Error).message}`);
  }
  ctx.onPathsChanged?.([rel]);
}

export function createCodeAgentTools(ctx: ToolContext): Record<string, ReturnType<typeof tool>> {
  return {
    list_files: tool({
      description: 'List all files under the build workspace with byte sizes.',
      inputSchema: z.object({
        subpath: z.string().optional().describe('Optional subdirectory to list, e.g. services/order-worker'),
      }),
      execute: wrapToolExecute(ctx, 'list_files', async ({ subpath }: { subpath?: string }) => {
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
        emitToolEvent(ctx, { name: 'list_files', subpath: subpath || '.', ok: true });
        return { ok: true, files: entries };
      }),
    }),

    read_file: tool({
      description: 'Read a file from the build workspace. Optionally limit to line range.',
      inputSchema: z.object({
        path: z.string().describe('Relative path, e.g. services/api/app.py'),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      }),
      execute: wrapToolExecute(ctx, 'read_file', async ({ path: relPath, startLine, endLine }: {
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
        emitToolEvent(ctx, { name: 'read_file', path: relPath, ok: true });
        return { ok: true, path: relPath, content: capOutput(content) };
      }),
    }),

    write_file: tool({
      description: 'Create or fully replace a file in the build workspace.',
      inputSchema: z.object({
        path: z.string().describe('Relative path to write'),
        content: z.string().describe('Full file content'),
      }),
      execute: wrapToolExecute(ctx, 'write_file', async ({ path: relPath, content }: { path: string; content: string }) => {
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
        await afterMutation(ctx, relPath);
        emitToolEvent(ctx, { name: 'write_file', path: relPath, ok: true });
        return { ok: true, path: relPath, bytes: content.length };
      }),
    }),

    edit_file: tool({
      description: 'Replace a single unique occurrence in a file (surgical patch).',
      inputSchema: z.object({
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
      }),
      execute: wrapToolExecute(ctx, 'edit_file', async ({ path: relPath, old_string, new_string }: {
        path: string;
        old_string: string;
        new_string: string;
      }) => {
        if (!isWritablePath(relPath)) {
          return { ok: false, error: 'path not writable' };
        }
        const abs = resolveInWorkspace(ctx.buildDir, relPath);
        if (!abs || !fs.existsSync(abs)) {
          return { ok: false, error: 'file not found' };
        }
        const content = fs.readFileSync(abs, 'utf8');
        const count = content.split(old_string).length - 1;
        if (count === 0) {
          return { ok: false, error: 'old_string not found — use read_file to verify content, or use write_file for full replace' };
        }
        if (count > 1) {
          return { ok: false, error: `old_string matches ${count} times — provide more context for a unique match` };
        }
        const updated = content.replace(old_string, new_string);
        if (updated.length > MAX_WRITE_CHARS) {
          return { ok: false, error: `result exceeds ${MAX_WRITE_CHARS} char limit — use write_file` };
        }
        fs.writeFileSync(abs, updated);
        await afterMutation(ctx, relPath);
        emitToolEvent(ctx, { name: 'edit_file', path: relPath, ok: true });
        return { ok: true, path: relPath, bytes: updated.length };
      }),
    }),

    grep: tool({
      description: 'Search for a pattern (literal string) in workspace files.',
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().optional().describe('Optional subdirectory or file to search'),
      }),
      execute: wrapToolExecute(ctx, 'grep', async ({ pattern, path: subpath }: { pattern: string; path?: string }) => {
        const root = subpath ? resolveInWorkspace(ctx.buildDir, subpath) : ctx.buildDir;
        if (!root || !fs.existsSync(root)) {
          return { ok: false, error: 'path not found' };
        }
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
        emitToolEvent(ctx, { name: 'grep', pattern, matchCount: matches.length, ok: true });
        return { ok: true, matches };
      }),
    }),

    search_code: tool({
      description: 'Semantic search over indexed code chunks in this build (use when logs are ambiguous).',
      inputSchema: z.object({
        query: z.string().describe('Natural language or error-focused search query'),
      }),
      execute: wrapToolExecute(ctx, 'search_code', async ({ query }: { query: string }) => {
        const hits = await codeChunkStore.search({
          draftSessionId: ctx.draftSessionId,
          buildSessionId: ctx.buildSessionId,
          query,
        });
        emitToolEvent(ctx, { name: 'search_code', query, hitCount: hits.length, ok: true });
        return {
          ok: true,
          hits: hits.map((h: { path: string; chunkIndex: number; content: string; distance: number }) => ({
            path: h.path,
            chunkIndex: h.chunkIndex,
            distance: h.distance,
            content: capOutput(h.content, 2000),
          })),
        };
      }),
    }),
  };
}

module.exports = {
  safeRel,
  createCodeAgentTools,
  MAX_READ_CHARS,
  MAX_WRITE_CHARS,
};
