'use strict';

/**
 * Upload a local directory tree to MinIO under prefix.
 */

import * as fs from 'fs';
import * as path from 'path';

const { getObjectStore, normalizeKey } = require('../../workspace/objectStore');

function walkFiles(dir: string, base = dir): Array<{ abs: string; rel: string }> {
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ abs: string; rel: string }> = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === '__pycache__' || name === '.git' || name === '.DS_Store' || name.endsWith('.pyc')) {
      continue;
    }
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) out.push(...walkFiles(abs, base));
    else out.push({ abs, rel: path.relative(base, abs).replace(/\\/g, '/') });
  }
  return out;
}

async function uploadDirToPrefix(
  localDir: string,
  s3Prefix: string,
  opts?: { replace?: boolean },
): Promise<{ count: number; keys: string[]; deleted: number }> {
  const store = getObjectStore();
  const prefix = normalizeKey(s3Prefix).replace(/\/?$/, '/');
  // Always replace: wipe prefix first so stale nested keys (e.g. gen/gen/) cannot linger
  const replace = opts?.replace ?? true;
  let deleted = 0;
  if (replace && typeof store.deletePrefix === 'function') {
    deleted = await store.deletePrefix(prefix);
  }
  const files = walkFiles(localDir);
  const keys: string[] = [];
  for (const f of files) {
    const key = `${prefix}${f.rel}`;
    const body = fs.readFileSync(f.abs);
    const ct = f.rel.endsWith('.json')
      ? 'application/json'
      : f.rel.endsWith('.py')
        ? 'text/x-python'
        : f.rel.endsWith('.md')
          ? 'text/markdown'
          : 'application/octet-stream';
    await store.putObject(key, body, ct);
    keys.push(key);
  }
  return { count: keys.length, keys, deleted };
}

module.exports = { uploadDirToPrefix, walkFiles };
