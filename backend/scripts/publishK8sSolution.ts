#!/usr/bin/env npx tsx
/**
 * Publish K8s lab solution/ files to MinIO (and sync pack write-up via register).
 *
 *   npx tsx scripts/publishK8sSolution.ts --id l1-namespace-and-pod
 */
'use strict';

import fs from 'fs';
import path from 'path';

require('dotenv').config({ override: true });

const { writeSolutionFiles } = require('../challenges/minioChallengeAssets');

function walkFiles(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      out[rel.replace(/\\/g, '/')] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(root, '');
  return out;
}

async function main(): Promise<void> {
  const idx = process.argv.indexOf('--id');
  const id = idx >= 0 ? process.argv[idx + 1] : 'l1-namespace-and-pod';
  const root = path.join(__dirname, '../challenges/k8s', id, 'solution');
  if (!fs.existsSync(root)) {
    throw new Error(`Missing ${root}`);
  }
  const files = walkFiles(root);
  const written = await writeSolutionFiles(id, files);
  console.log(`Published ${Object.keys(written).length} solution file(s) for ${id}:`);
  for (const k of Object.keys(written).sort()) console.log(`  - ${k}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
