'use strict';

// Promote a successful build (sandbox/builds/<id>/) into a permanent
// verified challenge (sandbox/verified/<slug>/) and re-seed the challenges
// table from disk so the new challenge appears in the library immediately.

const fs = require('fs');
const path = require('path');

const loader = require('../challenges/loader');
const { normalizeBucket } = require('../challenges/buckets');
const { VERIFIED_ROOT } = require('../sandbox/paths');

function slugify(s) {
  return String(s || 'challenge')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'challenge';
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Copy a built challenge into the verified dir, finalise its challenge.json,
// and refresh the in-process challenges cache. Returns { slug, verifiedDir,
// challenge }.
async function promote({ buildDir, builtChallenge, fallbackTitle, bucket }) {
  if (!buildDir || !fs.existsSync(buildDir)) {
    const e = new Error('build directory missing on disk; rebuild before promoting');
    e.status = 400;
    throw e;
  }

  const normalizedBucket = normalizeBucket(bucket);
  if (bucket && !normalizedBucket) {
    const e = new Error(`unknown bucket: ${bucket}`);
    e.status = 400;
    throw e;
  }

  const built = builtChallenge || {};
  const base = slugify(built.title || fallbackTitle || 'challenge');
  let slug = base;
  let i = 2;
  while (fs.existsSync(path.join(VERIFIED_ROOT, slug))) {
    slug = `${base}-${i++}`;
  }
  const dest = path.join(VERIFIED_ROOT, slug);
  copyDirSync(buildDir, dest);

  const challengeFile = path.join(dest, 'challenge.json');
  let cur = {};
  try {
    cur = JSON.parse(fs.readFileSync(challengeFile, 'utf8'));
  } catch (_e) { /* will overwrite */ }

  const merged = {
    ...cur,
    id: slug,
    title: built.title || built.meta?.name || cur.title,
    description: built.description || cur.description,
    difficulty: built.difficulty || built.meta?.difficulty || cur.difficulty || 'Medium',
    category: built.category || built.meta?.category || cur.category || 'General',
    bucket: normalizedBucket
      || normalizeBucket(built.bucket)
      || normalizeBucket(built.meta?.bucket)
      || normalizeBucket(cur.bucket)
      || null,
    tags: built.tags || built.meta?.tags || cur.tags || [],
    finalized: true,
    sandboxType: 'compose',
    arch: built.arch || cur.arch || null,
    metrics: built.metrics || cur.metrics || null,
    problemStatement: built.problemStatement || cur.problemStatement || null,
    validationSpec: built.validationSpec || cur.validationSpec || null,
  };
  if (merged.metrics?.recovery && merged.validationSpec) {
    merged.validationSpec.metricLogFormat = merged.metrics.format
      || merged.validationSpec.metricLogFormat;
    merged.validationSpec.metricsService = merged.metrics.service
      || merged.validationSpec.metricsService;
  }
  fs.writeFileSync(challengeFile, `${JSON.stringify(merged, null, 2)}\n`);

  await loader.seedChallengesFromDisk(VERIFIED_ROOT);
  await loader.loadChallengesFromDB();

  return { slug, verifiedDir: dest, challenge: merged };
}

module.exports = { promote, VERIFIED_ROOT };
