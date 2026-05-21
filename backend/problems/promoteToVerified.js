'use strict';

// Promote a successful build (sandbox/builds/<id>/) into a permanent
// verified challenge (sandbox/verified/<slug>/) and re-seed the challenges
// table from disk so the new challenge appears in the library immediately.

const fs = require('fs');
const path = require('path');

const loader = require('../challenges/loader');
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
async function promote({ buildDir, builtChallenge, fallbackTitle }) {
  if (!buildDir || !fs.existsSync(buildDir)) {
    const e = new Error('build directory missing on disk; rebuild before promoting');
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
    title: built.title || cur.title,
    description: built.description || cur.description,
    difficulty: built.difficulty || cur.difficulty || 'Medium',
    category: built.category || cur.category || 'General',
    tags: built.tags || cur.tags || [],
    finalized: true,
    sandboxType: 'compose',
    problemStatement: built.problemStatement || cur.problemStatement || null,
    validationSpec: built.validationSpec || cur.validationSpec || null,
  };
  fs.writeFileSync(challengeFile, `${JSON.stringify(merged, null, 2)}\n`);

  await loader.seedChallengesFromDisk(VERIFIED_ROOT);
  await loader.loadChallengesFromDB();

  return { slug, verifiedDir: dest, challenge: merged };
}

module.exports = { promote, VERIFIED_ROOT };
