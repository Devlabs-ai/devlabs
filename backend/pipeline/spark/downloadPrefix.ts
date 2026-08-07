'use strict';

/**
 * Download a MinIO/S3 prefix into a local directory (inverse of uploadDir).
 */

import * as fs from 'fs';
import * as path from 'path';

const { getObjectStore, normalizeKey } = require('../../workspace/objectStore');

async function downloadPrefixToDir(
  s3Prefix: string,
  localDir: string,
): Promise<{ count: number; keys: string[] }> {
  const store = getObjectStore();
  const prefix = normalizeKey(s3Prefix).replace(/\/?$/, '/');
  const keys = await store.listKeys(prefix);
  fs.mkdirSync(localDir, { recursive: true });
  const written: string[] = [];
  for (const key of keys) {
    if (key.endsWith('/')) continue;
    const rel = key.startsWith(prefix) ? key.slice(prefix.length) : key;
    if (!rel) continue;
    const body = await store.getObject(key);
    if (!body) continue;
    const abs = path.join(localDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    written.push(key);
  }
  return { count: written.length, keys: written };
}

module.exports = { downloadPrefixToDir };
