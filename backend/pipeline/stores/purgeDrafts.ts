'use strict';

import type { DraftSession } from '../../types/domain';

const fs = require('fs');
const path = require('path');
const pool = require('../../db/pool');
const draftStore = require('./problemDraftStore');
const { BUILDS_ROOT } = require('../../sandbox/paths');

function rmDirSync(dir: string | null | undefined): void {
  if (!dir || !fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

async function purgeAllDrafts(): Promise<{ purged: number }> {
  const { rows } = await pool.query(`SELECT id, build_dir FROM draft_sessions`);

  for (const row of rows as Array<{ id: string; build_dir: string | null }>) {
    if (row.build_dir) rmDirSync(row.build_dir);
  }

  if (fs.existsSync(BUILDS_ROOT)) {
    for (const ent of fs.readdirSync(BUILDS_ROOT, { withFileTypes: true })) {
      if (ent.isDirectory()) rmDirSync(path.join(BUILDS_ROOT, ent.name));
    }
  }

  await pool.query(`DELETE FROM reviews`);
  await pool.query(`DELETE FROM draft_sessions`);

  for (const id of (draftStore.list() as DraftSession[]).map((d) => d.id)) {
    // eslint-disable-next-line no-await-in-loop
    await draftStore.remove(id).catch(() => {});
  }

  console.log(`[drafts] purged ${rows.length} draft session(s) and review queue`);
  return { purged: rows.length };
}

module.exports = { purgeAllDrafts };
