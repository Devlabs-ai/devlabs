'use strict';

const pool = require('../db/pool');
const { archiveLegacyVerifiedOnDisk } = require('../challenges/archiveLegacy');
const { purgeAllDrafts } = require('../pipeline/stores/purgeDrafts');
const loader = require('../challenges/loader');

const LEGACY_ARCHIVE_KEY = 'legacy_archived_v1';

async function maybeArchiveLegacyChallengesAndPurgeDrafts() {
  const { rows } = await pool.query(
    `SELECT value FROM app_meta WHERE key = $1`,
    [LEGACY_ARCHIVE_KEY],
  );
  if (rows.length > 0) return { skipped: true };

  const { moved } = await archiveLegacyVerifiedOnDisk();
  const { purged } = await purgeAllDrafts();

  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)`,
    [LEGACY_ARCHIVE_KEY, String(Date.now())],
  );

  await loader.loadChallengesFromDB();

  console.log(
    `[boot] archived ${moved} legacy challenge(s) and purged ${purged} draft(s)`,
  );
  return { moved, purged };
}

module.exports = { maybeArchiveLegacyChallengesAndPurgeDrafts };
