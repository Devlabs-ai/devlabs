'use strict';

// Promote a successful build (sandbox/builds/<id>/) into a permanent
// verified challenge (sandbox/verified/<slug>/) and re-seed the challenges
// table from disk so the new challenge appears in the library immediately.

const fs = require('fs');
const path = require('path');

const loader = require('../challenges/loader');
const memoryStore = require('./memoryStore');

const ROOT = path.resolve(__dirname, '..', '..');
const VERIFIED_ROOT = path.join(ROOT, 'sandbox', 'verified');

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

  // Record a prose exemplar lesson so future drafts in a semantically
  // similar space retrieve this challenge as a working blueprint. Best
  // effort; never fail the promotion on memory errors.
  try {
    let composeYaml = '';
    try { composeYaml = fs.readFileSync(path.join(dest, 'docker-compose.yml'), 'utf8'); }
    catch (_e) { /* compose file may be at a non-standard name; skip */ }
    const imagesUsed = extractImagesFromCompose(composeYaml);
    const services = composeYaml ? extractServiceNames(composeYaml) : [];
    const categorySlugVal = categorySlug(merged.category);

    const titleStr = merged.title || slug;
    const servicesStr = services.length ? services.join(', ') : 'n/a';
    const imagesStr = imagesUsed.length ? imagesUsed.join(', ') : 'n/a';
    const text = `Verified working blueprint: ${titleStr}. Category: ${merged.category || 'general'}. Services: ${servicesStr}. Docker images used: ${imagesStr}. This compose was promoted to the verified library after passing the build pipeline — its image choices, env vars, and service layout are known-good and safe to reuse for similar challenges.`;

    await memoryStore.record({
      text,
      details: {
        slug,
        title: titleStr,
        services,
        imagesUsed,
        composeExcerpt: composeYaml.length > 0 ? composeYaml.slice(0, 2500) : null,
      },
      category: categorySlugVal,
    });
  } catch (e) {
    console.warn(`[promote] memory recording failed (non-fatal): ${e.message}`);
  }

  return { slug, verifiedDir: dest, challenge: merged };
}

// Local helpers — kept here so promoteToVerified doesn't have to import
// the deleted lessonSignatures.js or the heavier composeManager.
function categorySlug(category) {
  if (!category || typeof category !== 'string') return null;
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || null;
}

function extractImagesFromCompose(yaml) {
  if (!yaml || typeof yaml !== 'string') return [];
  const out = new Set();
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s+image\s*:\s*['"]?([^\s'"#]+)['"]?\s*(?:#.*)?$/);
    if (m) out.add(m[1]);
  }
  return Array.from(out);
}

function extractServiceNames(composeYaml) {
  const out = [];
  let inServices = false;
  for (const rawLine of (composeYaml || '').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^[A-Za-z_][\w-]*\s*:/.test(line)) {
      inServices = /^services\s*:/.test(line);
      continue;
    }
    if (!inServices) continue;
    const m = line.match(/^  ([A-Za-z][\w-]*)\s*:\s*(?:#.*)?$/);
    if (m) out.push(m[1]);
  }
  return out;
}

module.exports = { promote, VERIFIED_ROOT };
