'use strict';

/**
 * One spark workspace session per (challengeId, userId).
 * Consolidates legacy per-open UUID prefixes under the stable
 * workspaces/{challenge}/{user}/project/ layout.
 */

const pool = require('../db/pool');
const sessionStore = require('../db/sessionStore');
const workspaceStore = require('./workspaceStore');
const { getObjectStore, normalizeKey } = require('./objectStore');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function consolidateObjectStoreForOwner(
  challengeId: string,
  owner: string,
  stablePrefix: string,
): Promise<void> {
  const store = getObjectStore();
  const ownerRoot = normalizeKey(`workspaces/${challengeId}/${owner}`).replace(/\/?$/, '/');
  const stable = normalizeKey(stablePrefix).replace(/\/?$/, '/');
  const keys = await store.listKeys(ownerRoot);

  for (const key of keys) {
    if (!key.startsWith(ownerRoot)) continue;
    const rest = key.slice(ownerRoot.length); // e.g. project/README.md OR {uuid}/project/README.md
    if (rest.startsWith('project/')) continue; // already stable

    const parts = rest.split('/');
    const maybeSession = parts[0];
    if (!UUID_RE.test(maybeSession)) continue;
    if (parts[1] !== 'project') continue;

    const rel = parts.slice(2).join('/');
    if (!rel) continue;
    const dest = `${stable}${rel}`;
    const existing = await store.getObject(dest);
    if (existing == null) {
      await store.copyObject(key, dest);
    }
    await store.deleteObject(key);
  }

  // After deletes, MinIO can leave empty UUID "folders" as delete-markers.
  // Wipe markers under any leftover uuid/ prefixes for this owner.
  const after = await store.listKeys(ownerRoot);
  const uuidRoots = new Set<string>();
  for (const key of after) {
    const rest = key.slice(ownerRoot.length);
    const maybe = rest.split('/')[0];
    if (UUID_RE.test(maybe)) uuidRoots.add(`${ownerRoot}${maybe}/`);
  }
  // Also discover empty prefixes via delete-marker purge on owner root.
  const purged = await store.purgeDeleteMarkers(ownerRoot);
  if (purged > 0) {
    console.log(`[spark-cleanup] purged ${purged} delete marker(s) under ${ownerRoot}`);
  }
  for (const root of uuidRoots) {
    await store.deletePrefix(root);
    await store.purgeDeleteMarkers(root);
  }
}

async function cleanupSparkWorkspaces(): Promise<void> {
  // Normalize null user_id → 'anonymous' for spark rows.
  await pool.query(
    `UPDATE sessions
        SET user_id = 'anonymous'
      WHERE runtime = 'spark-platform'
        AND (user_id IS NULL OR user_id = '')`,
  );

  const { rows } = await pool.query(
    `SELECT challenge_id, user_id, array_agg(id ORDER BY start_time ASC, id ASC) AS ids
       FROM sessions
      WHERE runtime = 'spark-platform'
        AND challenge_id IS NOT NULL
        AND user_id IS NOT NULL
      GROUP BY challenge_id, user_id`,
  );

  let kept = 0;
  let removed = 0;

  for (const row of rows as Array<{ challenge_id: string; user_id: string; ids: string[] }>) {
    const ids = row.ids || [];
    if (ids.length === 0) continue;
    const keepId = ids[0];
    const dropIds = ids.slice(1);
    const owner = workspaceStore.sanitizeOwner(row.user_id);
    const stablePrefix = workspaceStore.buildWorkspacePrefix(row.challenge_id, owner);

    try {
      await consolidateObjectStoreForOwner(row.challenge_id, owner, stablePrefix);
    } catch (e: unknown) {
      console.warn(
        `[spark-cleanup] object-store consolidate failed for ${row.challenge_id}/${owner}:`,
        (e as Error).message,
      );
    }

    await pool.query(
      `UPDATE sessions
          SET workspace_prefix = $2,
              user_id = $3,
              status = CASE WHEN status = 'ended' THEN 'ended' ELSE 'active' END,
              end_time = CASE WHEN status = 'ended' THEN end_time ELSE NULL END
        WHERE id = $1`,
      [keepId, stablePrefix, owner],
    );

    try {
      await workspaceStore.reindexFromStore(keepId, stablePrefix);
    } catch (e: unknown) {
      console.warn(
        `[spark-cleanup] reindex failed for ${keepId}:`,
        (e as Error).message,
      );
    }

    if (dropIds.length > 0) {
      await pool.query(`DELETE FROM sessions WHERE id = ANY($1::text[])`, [dropIds]);
      for (const id of dropIds) sessionStore.remove(id);
      removed += dropIds.length;
    }
    kept += 1;

    // Refresh in-memory session if present / active.
    const mem = sessionStore.get(keepId) as (Record<string, unknown> & { id: string }) | null;
    if (mem) {
      mem.workspacePrefix = stablePrefix;
      mem.userId = owner;
      mem.runtime = 'spark-platform';
    }
  }

  // Unique: one spark session per challenge + user going forward.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_spark_user_challenge
      ON sessions (challenge_id, user_id)
      WHERE runtime = 'spark-platform' AND user_id IS NOT NULL AND challenge_id IS NOT NULL
  `);

  // Drop leftover probe objects + any remaining delete markers under workspaces/.
  try {
    const store = getObjectStore();
    const n = await store.deletePrefix('workspaces/_probe');
    if (n > 0) console.log(`[spark-cleanup] deleted ${n} probe object(s)`);
    const markers = await store.purgeDeleteMarkers('workspaces/');
    if (markers > 0) console.log(`[spark-cleanup] purged ${markers} workspace delete marker(s)`);
  } catch (_e) {
    // MinIO may be down during boot — non-fatal.
  }

  console.log(`[spark-cleanup] kept ${kept} workspace(s), removed ${removed} duplicate session(s)`);
}

module.exports = { cleanupSparkWorkspaces };
