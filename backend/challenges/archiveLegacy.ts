'use strict';

const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { VERIFIED_ROOT, ARCHIVE_ROOT } = require('../sandbox/paths');

function rmDirSync(dir: string): void {
  if (!dir || !fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

async function archiveLegacyVerifiedOnDisk(): Promise<{ moved: number }> {
  if (!fs.existsSync(VERIFIED_ROOT)) return { moved: 0 };

  fs.mkdirSync(ARCHIVE_ROOT, { recursive: true });

  const entries = fs.readdirSync(VERIFIED_ROOT, { withFileTypes: true });
  let moved = 0;
  const now = Date.now();

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const slug: string = ent.name;
    const src = path.join(VERIFIED_ROOT, slug);
    const dest = path.join(ARCHIVE_ROOT, slug);

    if (fs.existsSync(dest)) {
      rmDirSync(src);
    } else {
      fs.renameSync(src, dest);
    }

    const srcResolved = path.resolve(src);
    const destResolved = path.resolve(dest);

    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `UPDATE challenges
          SET archived = true,
              verified_dir = $1,
              updated_at = $2
        WHERE verified_dir = $3
           OR verified_dir = $4
           OR id = $5`,
      [destResolved, now, srcResolved, src, slug],
    );

    moved += 1;
    console.log(`[archive] moved ${slug} → sandbox/archive/`);
  }

  if (moved > 0) {
    await pool.query(
      `UPDATE challenges SET archived = true, updated_at = $1 WHERE archived = false`,
      [now],
    );
  }

  return { moved };
}

module.exports = { archiveLegacyVerifiedOnDisk };
