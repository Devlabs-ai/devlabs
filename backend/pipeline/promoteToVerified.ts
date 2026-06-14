'use strict';

// Promote a successful build into a permanent verified challenge.

import type { ValidationSpec } from '../types/domain';

const fs = require('fs');
const path = require('path');

const loader = require('../challenges/loader');
const { normalizeBucket } = require('../challenges/buckets');
const { VERIFIED_ROOT } = require('../sandbox/paths');
const pool = require('../db/pool');

function slugify(s: string | null | undefined): string {
  return String(s || 'challenge')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'challenge';
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function promote({
  buildDir,
  builtChallenge,
  fallbackTitle,
  bucket,
  authoredBy = null,
}: {
  buildDir: string;
  builtChallenge?: Record<string, unknown>;
  fallbackTitle?: string | null;
  bucket?: string | null;
  authoredBy?: string | null;
}): Promise<{ slug: string; verifiedDir: string; challenge: Record<string, unknown> }> {
  if (!buildDir || !fs.existsSync(buildDir)) {
    const e = new Error('build directory missing on disk; rebuild before promoting') as Error & { status?: number };
    e.status = 400;
    throw e;
  }

  const normalizedBucket = normalizeBucket(bucket);
  if (bucket && !normalizedBucket) {
    const e = new Error(`unknown bucket: ${bucket}`) as Error & { status?: number };
    e.status = 400;
    throw e;
  }

  const built = builtChallenge || {};
  const base = slugify((built.title as string) || fallbackTitle || 'challenge');
  let slug = base;
  let i = 2;
  while (fs.existsSync(path.join(VERIFIED_ROOT, slug))) {
    slug = `${base}-${i++}`;
  }
  const dest = path.join(VERIFIED_ROOT, slug);
  copyDirSync(buildDir, dest);

  const challengeFile = path.join(dest, 'challenge.json');
  let cur: Record<string, unknown> = {};
  try {
    cur = JSON.parse(fs.readFileSync(challengeFile, 'utf8'));
  } catch (_e) { /* will overwrite */ }

  const merged: Record<string, unknown> = {
    ...cur,
    id: slug,
    title: built.title || (built.meta as Record<string, unknown>)?.name || cur.title,
    description: built.description || cur.description,
    difficulty: built.difficulty || (built.meta as Record<string, unknown>)?.difficulty || cur.difficulty || 'Medium',
    category: built.category || (built.meta as Record<string, unknown>)?.category || cur.category || 'General',
    bucket: normalizedBucket
      || normalizeBucket(built.bucket as string)
      || normalizeBucket((built.meta as Record<string, unknown>)?.bucket as string)
      || normalizeBucket(cur.bucket as string)
      || null,
    tags: built.tags || (built.meta as Record<string, unknown>)?.tags || cur.tags || [],
    finalized: true,
    sandboxType: 'compose',
    arch: built.arch || cur.arch || null,
    metrics: built.metrics || cur.metrics || null,
    problemStatement: built.problemStatement || cur.problemStatement || null,
    validationSpec: built.validationSpec || cur.validationSpec || null,
  };
  if ((merged.metrics as Record<string, unknown>)?.recovery && merged.validationSpec) {
    (merged.validationSpec as ValidationSpec).metricLogFormat = (merged.metrics as Record<string, unknown>).format as string
      || (merged.validationSpec as ValidationSpec).metricLogFormat;
    (merged.validationSpec as ValidationSpec).metricsService = (merged.metrics as Record<string, unknown>).service as string
      || (merged.validationSpec as ValidationSpec).metricsService;
  }
  fs.writeFileSync(challengeFile, `${JSON.stringify(merged, null, 2)}\n`);

  await loader.seedChallengesFromDisk(VERIFIED_ROOT);
  await loader.loadChallengesFromDB();

  if (authoredBy) {
    await pool.query(
      `UPDATE challenges SET authored_by = $1 WHERE id = $2`,
      [authoredBy, slug],
    ).catch((e: Error) => console.warn('[promote] could not set authored_by:', e.message));
  }

  return { slug, verifiedDir: dest, challenge: merged };
}

module.exports = { promote, VERIFIED_ROOT };
