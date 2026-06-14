'use strict';

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const pool = require('../../db/pool');
const llm = require('../../llm/client');

const CHUNK_MAX_CHARS = 3000;
const SEARCH_K = 8;
const SEARCH_MAX_DISTANCE = 0.55;

function toPgVector(arr: number[]): string {
  return `[${arr.join(',')}]`;
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function chunkText(content: string): string[] {
  if (content.length <= CHUNK_MAX_CHARS) return [content];
  const blocks = content.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = '';
  for (const block of blocks) {
    const next = buf ? `${buf}\n\n${block}` : block;
    if (next.length > CHUNK_MAX_CHARS && buf) {
      chunks.push(buf);
      buf = block;
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);
  if (chunks.length === 0) return [content.slice(0, CHUNK_MAX_CHARS)];
  return chunks;
}

interface IndexableFile {
  relPath: string;
  content: string;
}

function collectIndexableFiles(buildDir: string): IndexableFile[] {
  const out: IndexableFile[] = [];
  const composePath = path.join(buildDir, 'docker-compose.yml');
  if (fs.existsSync(composePath)) {
    out.push({ relPath: 'docker-compose.yml', content: fs.readFileSync(composePath, 'utf8') });
  }
  const challengePath = path.join(buildDir, 'challenge.json');
  if (fs.existsSync(challengePath)) {
    out.push({ relPath: 'challenge.json', content: fs.readFileSync(challengePath, 'utf8') });
  }
  const servicesDir = path.join(buildDir, 'services');
  if (fs.existsSync(servicesDir)) {
    for (const svc of fs.readdirSync(servicesDir)) {
      const svcPath = path.join(servicesDir, svc);
      if (!fs.statSync(svcPath).isDirectory()) continue;
      for (const file of fs.readdirSync(svcPath)) {
        const abs = path.join(svcPath, file);
        if (!fs.statSync(abs).isFile()) continue;
        out.push({
          relPath: `services/${svc}/${file}`,
          content: fs.readFileSync(abs, 'utf8'),
        });
      }
    }
  }
  const initDir = path.join(buildDir, 'init');
  if (fs.existsSync(initDir)) {
    for (const file of fs.readdirSync(initDir)) {
      const abs = path.join(initDir, file);
      if (!fs.statSync(abs).isFile()) continue;
      out.push({ relPath: `init/${file}`, content: fs.readFileSync(abs, 'utf8') });
    }
  }
  return out;
}

async function upsertChunks({
  draftSessionId,
  buildSessionId,
  attempt,
  relPath,
  content,
}: {
  draftSessionId?: string | null;
  buildSessionId: string;
  attempt: number;
  relPath: string;
  content: string;
}): Promise<void> {
  const contentHash = hashContent(content);
  const { rows } = await pool.query(
    `SELECT content_hash FROM build_code_chunks
      WHERE build_session_id = $1 AND path = $2
      ORDER BY chunk_index ASC LIMIT 1`,
    [buildSessionId, relPath],
  );
  if (rows[0]?.content_hash === contentHash) return;

  await pool.query(
    `DELETE FROM build_code_chunks WHERE build_session_id = $1 AND path = $2`,
    [buildSessionId, relPath],
  );

  const chunks = chunkText(content);
  const now = Date.now();
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedText = `path: ${relPath}\n${chunk}`;
    const embedding = await llm.embed(embedText);
    await pool.query(
      `INSERT INTO build_code_chunks
         (draft_session_id, build_session_id, attempt, path, chunk_index, content, content_hash, embedding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9)`,
      [
        draftSessionId || null,
        buildSessionId,
        attempt,
        relPath,
        i,
        chunk,
        contentHash,
        embedding ? toPgVector(embedding) : null,
        now,
      ],
    );
  }
}

async function indexBuildDir({
  draftSessionId,
  buildSessionId,
  attempt,
  buildDir,
}: {
  draftSessionId?: string | null;
  buildSessionId: string;
  attempt: number;
  buildDir: string;
}): Promise<void> {
  const files = collectIndexableFiles(buildDir);
  console.log(`[codeChunks] indexing ${files.length} file(s) for build ${buildSessionId}`);
  for (const f of files) {
    try {
      await upsertChunks({
        draftSessionId,
        buildSessionId,
        attempt,
        relPath: f.relPath,
        content: f.content,
      });
    } catch (e) {
      console.warn(`[codeChunks] index ${f.relPath} failed: ${(e as Error).message}`);
    }
  }
}

async function indexPaths({
  draftSessionId,
  buildSessionId,
  attempt,
  buildDir,
  paths,
}: {
  draftSessionId?: string | null;
  buildSessionId: string;
  attempt: number;
  buildDir: string;
  paths: string[];
}): Promise<void> {
  const files = collectIndexableFiles(buildDir);
  const wanted = new Set(paths.map((p) => p.replace(/^\/+/, '')));
  for (const f of files) {
    if (!wanted.has(f.relPath)) continue;
    try {
      await upsertChunks({
        draftSessionId,
        buildSessionId,
        attempt,
        relPath: f.relPath,
        content: f.content,
      });
    } catch (e) {
      console.warn(`[codeChunks] indexPaths ${f.relPath} failed: ${(e as Error).message}`);
    }
  }
}

interface SearchHit {
  path: string;
  chunkIndex: number;
  content: string;
  distance: number;
  buildSessionId?: string;
}

/**
 * Semantic search over persisted code chunks.
 * Prefers the current build_session_id, then falls back to other builds for the
 * same draft_session_id (prior attempts / future work on this challenge).
 */
async function search({
  draftSessionId,
  buildSessionId,
  query,
  k = SEARCH_K,
  maxDistance = SEARCH_MAX_DISTANCE,
}: {
  draftSessionId?: string | null;
  buildSessionId: string;
  query: string;
  k?: number;
  maxDistance?: number;
}): Promise<SearchHit[]> {
  if (!query?.trim()) return [];
  const vec = await llm.embed(query);
  if (!vec) return [];
  const pgVec = toPgVector(vec);
  try {
    if (draftSessionId) {
      const { rows } = await pool.query(
        `SELECT path, chunk_index, content, build_session_id,
                (embedding <=> $1::vector) AS distance
           FROM build_code_chunks
          WHERE draft_session_id = $2
            AND embedding IS NOT NULL
            AND (embedding <=> $1::vector) <= $3
          ORDER BY
            CASE WHEN build_session_id = $4 THEN 0 ELSE 1 END,
            embedding <=> $1::vector
          LIMIT $5`,
        [pgVec, draftSessionId, maxDistance, buildSessionId, k],
      );
      return rows.map((r: Record<string, unknown>) => ({
        path: r.path as string,
        chunkIndex: r.chunk_index as number,
        content: r.content as string,
        distance: r.distance as number,
        buildSessionId: r.build_session_id as string,
      }));
    }

    const { rows } = await pool.query(
      `SELECT path, chunk_index, content, build_session_id,
              (embedding <=> $1::vector) AS distance
         FROM build_code_chunks
        WHERE build_session_id = $2
          AND embedding IS NOT NULL
          AND (embedding <=> $1::vector) <= $3
        ORDER BY embedding <=> $1::vector
        LIMIT $4`,
      [pgVec, buildSessionId, maxDistance, k],
    );
    return rows.map((r: Record<string, unknown>) => ({
      path: r.path as string,
      chunkIndex: r.chunk_index as number,
      content: r.content as string,
      distance: r.distance as number,
      buildSessionId: r.build_session_id as string,
    }));
  } catch (e) {
    console.warn(`[codeChunks] search failed: ${(e as Error).message}`);
    return [];
  }
}

/** Explicit cleanup only — chunks are retained by default after builds complete. */
async function purge(buildSessionId: string): Promise<void> {
  try {
    await pool.query(`DELETE FROM build_code_chunks WHERE build_session_id = $1`, [buildSessionId]);
  } catch (e) {
    console.warn(`[codeChunks] purge failed: ${(e as Error).message}`);
  }
}

async function purgeByDraftSession(draftSessionId: string): Promise<void> {
  try {
    await pool.query(`DELETE FROM build_code_chunks WHERE draft_session_id = $1`, [draftSessionId]);
  } catch (e) {
    console.warn(`[codeChunks] purgeByDraftSession failed: ${(e as Error).message}`);
  }
}

module.exports = {
  indexBuildDir,
  indexPaths,
  search,
  purge,
  purgeByDraftSession,
  collectIndexableFiles,
};
