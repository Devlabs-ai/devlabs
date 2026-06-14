#!/usr/bin/env node
'use strict';

// Backfill the `bucket` column on `challenges` rows that are NULL.
//
// On every backend boot, `seedChallengesFromDisk` already UPSERTs every
// verified challenge.json into the table including its `bucket`. So in
// practice the only rows with a NULL bucket are ones whose on-disk
// challenge.json predates the bucket field. This script handles both cases:
//
//   node scripts/backfillBuckets.js
//       Audit. Lists challenges with NULL bucket and exits 0.
//
//   node scripts/backfillBuckets.js --from-disk
//       Re-read challenge.json under each row's verified_dir and apply the
//       `bucket` field found there (no-op for any file that also lacks it).
//
//   node scripts/backfillBuckets.js --apply=<slug>=<bucket>[,<slug>=<bucket>...]
//       Manually set buckets on specific slugs. Useful when challenge.json
//       can't be edited (e.g. a non-dev deployment).
//
// Connects via the standard PG* env vars; running it from the backend dir
// inherits backend/.env if you've sourced it (or use `make backfill-buckets`).

const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { normalizeBucket, BUCKETS } = require('../challenges/buckets');

interface ParsedArgs {
  mode: string;
  applies: Array<{ slug: string; bucket: string }>;
  invalid?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { mode: 'audit', applies: [] };
  for (const raw of argv) {
    if (raw === '--from-disk') {
      args.mode = 'from-disk';
    } else if (raw.startsWith('--apply=')) {
      args.mode = 'apply';
      for (const entry of raw.slice('--apply='.length).split(',')) {
        const [slug, bucket] = entry.split('=');
        if (slug && bucket) args.applies.push({ slug: slug.trim(), bucket: bucket.trim() });
      }
    } else if (raw === '--help' || raw === '-h') {
      args.mode = 'help';
    } else {
      console.error(`unknown argument: ${raw}`);
      args.mode = 'help';
      args.invalid = true;
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write([
    'Usage:',
    '  node scripts/backfillBuckets.js                        Audit NULL-bucket challenges',
    '  node scripts/backfillBuckets.js --from-disk            Backfill from challenge.json on disk',
    '  node scripts/backfillBuckets.js --apply=slug=bucket,…  Bulk-assign buckets manually',
    '',
    `Valid buckets: ${BUCKETS.map((b: { id: string }) => b.id).join(', ')}`,
    '',
  ].join('\n'));
}

async function audit(): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pool.query(
    `SELECT id, title, category, verified_dir
       FROM challenges
      WHERE bucket IS NULL
      ORDER BY id`,
  );
  if (!rows.length) {
    console.log('All challenges have a bucket assigned.');
    return rows;
  }
  console.log(`Found ${rows.length} challenge${rows.length === 1 ? '' : 's'} without a bucket:`);
  for (const r of rows) {
    const dir = r.verified_dir ? path.basename(r.verified_dir) : '(no verified_dir)';
    console.log(`  - ${r.id}  title="${r.title}"  category=${r.category || '-'}  dir=${dir}`);
  }
  console.log('\nRe-run with --from-disk to backfill from challenge.json files,');
  console.log('or --apply=<slug>=<bucket>[,...] to set buckets manually.');
  console.log(`Valid buckets: ${BUCKETS.map((b: { id: string }) => b.id).join(', ')}`);
  return rows;
}

async function fromDisk(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, verified_dir
       FROM challenges
      WHERE bucket IS NULL AND verified_dir IS NOT NULL
      ORDER BY id`,
  );
  if (!rows.length) {
    console.log('No NULL-bucket rows with a verified_dir to backfill from.');
    return;
  }
  let updated = 0;
  for (const r of rows) {
    const file = path.join(r.verified_dir, 'challenge.json');
    if (!fs.existsSync(file)) {
      console.log(`  skip ${r.id}: ${file} not found`);
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const bucket = normalizeBucket(parsed.bucket);
      if (!bucket) {
        console.log(`  skip ${r.id}: challenge.json has no valid bucket`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `UPDATE challenges SET bucket = $1, updated_at = $2 WHERE id = $3`,
        [bucket, Date.now(), r.id],
      );
      console.log(`  ok ${r.id}: set to ${bucket}`);
      updated += 1;
    } catch (e: unknown) {
      console.log(`  fail ${r.id}: ${(e as Error).message}`);
    }
  }
  console.log(`\nBackfilled ${updated} row${updated === 1 ? '' : 's'} from disk.`);
}

async function applyManual(applies: Array<{ slug: string; bucket: string }>): Promise<void> {
  if (!applies.length) {
    console.error('No --apply entries provided. Usage: --apply=slug=bucket[,slug=bucket]');
    process.exitCode = 1;
    return;
  }
  let updated = 0;
  for (const { slug, bucket } of applies) {
    const normalized = normalizeBucket(bucket);
    if (!normalized) {
      console.log(`  invalid ${slug}: unknown bucket "${bucket}"`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const { rowCount } = await pool.query(
      `UPDATE challenges SET bucket = $1, updated_at = $2 WHERE id = $3`,
      [normalized, Date.now(), slug],
    );
    if (rowCount === 0) {
      console.log(`  not found: ${slug}`);
    } else {
      console.log(`  ok ${slug}: set to ${normalized}`);
      updated += 1;
    }
  }
  console.log(`\nUpdated ${updated} row${updated === 1 ? '' : 's'}.`);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (args.mode === 'help') {
      printHelp();
      if (args.invalid) process.exitCode = 1;
    } else if (args.mode === 'apply') {
      await applyManual(args.applies);
    } else if (args.mode === 'from-disk') {
      await fromDisk();
    } else {
      await audit();
    }
  } catch (e: unknown) {
    console.error('Error:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
