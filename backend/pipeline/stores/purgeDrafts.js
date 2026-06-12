'use strict';

const fs = require('fs');
const path = require('path');
const pool = require('../../db/pool');
const draftStore = require('./problemDraftStore');
const { BUILDS_ROOT } = require('../../sandbox/paths');

function rmDirSync(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

async function purgeAllDrafts() {
  const { rows } = await pool.query(`SELECT id, build_dir FROM draft_sessions`);

  for (const row of rows) {
    if (row.build_dir) rmDirSync(row.build_dir);
  }

  if (fs.existsSync(BUILDS_ROOT)) {
    for (const ent of fs.readdirSync(BUILDS_ROOT, { withFileTypes: true })) {
      if (ent.isDirectory()) rmDirSync(path.join(BUILDS_ROOT, ent.name));
    }
  }

  await pool.query(`DELETE FROM reviews`);
  await pool.query(`DELETE FROM draft_sessions`);

  for (const id of draftStore.list().map((d) => d.id)) {
    // eslint-disable-next-line no-await-in-loop
    await draftStore.remove(id).catch(() => {});
  }

  console.log(`[drafts] purged ${rows.length} draft session(s) and review queue`);
  return { purged: rows.length };
}

module.exports = { purgeAllDrafts };
