'use strict';

import { createHash } from 'crypto';

const pool = require('../db/pool');
const { getObjectStore, normalizeKey } = require('./objectStore');

export type WorkspaceFiles = Record<string, string>;

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function sanitizeOwner(userId: string): string {
  return (userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_') || 'anonymous';
}

function sanitizeChallengeId(challengeId: string): string {
  return (challengeId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
}

/** One stable prefix per challenge id + user (no session id). */
function buildWorkspacePrefix(challengeId: string, userId: string): string {
  const safeChallenge = sanitizeChallengeId(challengeId);
  const safeUser = sanitizeOwner(userId);
  return `workspaces/${safeChallenge}/${safeUser}/project`;
}

function objectKey(workspacePrefix: string, filePath: string): string {
  const prefix = normalizeKey(workspacePrefix).replace(/\/?$/, '/');
  const rel = normalizeKey(filePath);
  if (!rel || rel.includes('..')) throw Object.assign(new Error('invalid path'), { status: 400 });
  return `${prefix}${rel}`;
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.py')) return 'text/x-python; charset=utf-8';
  if (filePath.endsWith('.md')) return 'text/markdown; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

async function upsertFileRow(
  sessionId: string,
  filePath: string,
  contentHash: string,
  sizeBytes: number,
  etag: string | null,
): Promise<void> {
  const now = Date.now();
  await pool.query(
    `INSERT INTO session_workspace_files
       (session_id, path, content_hash, size_bytes, etag, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (session_id, path) DO UPDATE SET
       content_hash = EXCLUDED.content_hash,
       size_bytes   = EXCLUDED.size_bytes,
       etag         = EXCLUDED.etag,
       updated_at   = EXCLUDED.updated_at`,
    [sessionId, filePath, contentHash, sizeBytes, etag, now],
  );
  await pool.query(
    `UPDATE sessions SET workspace_updated_at = $2 WHERE id = $1`,
    [sessionId, now],
  );
}

async function putFile(
  sessionId: string,
  workspacePrefix: string,
  filePath: string,
  content: string,
): Promise<{ path: string; hash: string; size: number }> {
  const store = getObjectStore();
  const key = objectKey(workspacePrefix, filePath);
  const hash = hashContent(content);
  const result = await store.putObject(key, content, contentTypeFor(filePath));
  await upsertFileRow(sessionId, filePath, hash, result.size, result.etag);
  return { path: filePath, hash, size: result.size };
}

async function getFile(
  workspacePrefix: string,
  filePath: string,
): Promise<string | null> {
  const store = getObjectStore();
  const key = objectKey(workspacePrefix, filePath);
  const buf = await store.getObject(key);
  return buf ? buf.toString('utf8') : null;
}

async function deleteFile(
  sessionId: string,
  workspacePrefix: string,
  filePath: string,
): Promise<void> {
  const store = getObjectStore();
  const key = objectKey(workspacePrefix, filePath);
  await store.deleteObject(key);
  await pool.query(
    `DELETE FROM session_workspace_files WHERE session_id = $1 AND path = $2`,
    [sessionId, filePath],
  );
  await pool.query(
    `UPDATE sessions SET workspace_updated_at = $2 WHERE id = $1`,
    [sessionId, Date.now()],
  );
}

async function renameFile(
  sessionId: string,
  workspacePrefix: string,
  fromPath: string,
  toPath: string,
): Promise<void> {
  const content = await getFile(workspacePrefix, fromPath);
  if (content == null) {
    throw Object.assign(new Error('file not found'), { status: 404 });
  }
  await putFile(sessionId, workspacePrefix, toPath, content);
  await deleteFile(sessionId, workspacePrefix, fromPath);
}

async function listFiles(sessionId: string): Promise<
  Array<{ path: string; contentHash: string | null; sizeBytes: number; updatedAt: number }>
> {
  const { rows } = await pool.query(
    `SELECT path, content_hash, size_bytes, updated_at
       FROM session_workspace_files
      WHERE session_id = $1
      ORDER BY path`,
    [sessionId],
  );
  return rows.map((r: { path: string; content_hash: string | null; size_bytes: number; updated_at: string | number }) => ({
    path: r.path,
    contentHash: r.content_hash,
    sizeBytes: Number(r.size_bytes) || 0,
    updatedAt: Number(r.updated_at) || 0,
  }));
}

/** Rebuild Postgres file index from objects currently under the prefix. */
async function reindexFromStore(
  sessionId: string,
  workspacePrefix: string,
): Promise<WorkspaceFiles> {
  const store = getObjectStore();
  const prefix = normalizeKey(workspacePrefix).replace(/\/?$/, '/');
  const keys = await store.listKeys(prefix);
  const files: WorkspaceFiles = {};
  await pool.query(`DELETE FROM session_workspace_files WHERE session_id = $1`, [sessionId]);
  for (const key of keys) {
    const rel = key.startsWith(prefix) ? key.slice(prefix.length) : key;
    if (!rel || rel.endsWith('/')) continue;
    const buf = await store.getObject(key);
    if (!buf) continue;
    const content = buf.toString('utf8');
    files[rel] = content;
    await upsertFileRow(sessionId, rel, hashContent(content), buf.length, null);
  }
  return files;
}

async function loadAllFiles(
  sessionId: string,
  workspacePrefix: string,
): Promise<WorkspaceFiles> {
  const listed = await listFiles(sessionId);
  if (listed.length === 0) {
    return reindexFromStore(sessionId, workspacePrefix);
  }
  const files: WorkspaceFiles = {};
  for (const row of listed) {
    const content = await getFile(workspacePrefix, row.path);
    if (content != null) files[row.path] = content;
  }
  // Index existed but objects missing (prefix moved) — rebuild from store.
  if (Object.keys(files).length === 0) {
    return reindexFromStore(sessionId, workspacePrefix);
  }
  return files;
}

async function seedFiles(
  sessionId: string,
  workspacePrefix: string,
  files: WorkspaceFiles,
): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    await putFile(sessionId, workspacePrefix, filePath, content ?? '');
  }
}

/** Seed only paths that are not already present in the object store. */
async function seedMissingFiles(
  sessionId: string,
  workspacePrefix: string,
  files: WorkspaceFiles,
): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    const existing = await getFile(workspacePrefix, filePath);
    if (existing != null) continue;
    await putFile(sessionId, workspacePrefix, filePath, content ?? '');
  }
}

module.exports = {
  putFile,
  getFile,
  deleteFile,
  renameFile,
  listFiles,
  loadAllFiles,
  seedFiles,
  seedMissingFiles,
  reindexFromStore,
  buildWorkspacePrefix,
  sanitizeOwner,
  hashContent,
};
