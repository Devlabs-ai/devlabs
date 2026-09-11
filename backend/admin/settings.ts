'use strict';

const pool = require('../db/pool');

const WATCHER_KEY = 'spark_job_watcher_enabled';
const PLATFORM_API =
  process.env.SPARK_PLATFORM_API_URL || 'http://192.168.1.2:30088';

function parseEnabled(raw: unknown, fallback = true): boolean {
  if (raw == null) return fallback;
  const s = String(raw).trim().toLowerCase();
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  return fallback;
}

async function getSparkJobWatcherEnabled(): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT value FROM app_meta WHERE key = $1`,
    [WATCHER_KEY],
  );
  return parseEnabled(rows[0]?.value, true);
}

async function saveSparkJobWatcherEnabled(enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [WATCHER_KEY, enabled ? 'true' : 'false'],
  );
}

async function pushWatcherToPlatform(enabled: boolean): Promise<boolean> {
  const url = `${PLATFORM_API.replace(/\/$/, '')}/api/watcher`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    return res.ok;
  } catch (e: unknown) {
    console.warn('[admin] spark watcher cluster sync failed:', (e as Error).message);
    return false;
  }
}

async function setSparkJobWatcherEnabled(enabled: boolean): Promise<{
  sparkJobWatcherEnabled: boolean;
  clusterSynced: boolean;
}> {
  await saveSparkJobWatcherEnabled(enabled);
  const clusterSynced = await pushWatcherToPlatform(enabled);
  return { sparkJobWatcherEnabled: enabled, clusterSynced };
}

async function syncSparkJobWatcherToPlatform(): Promise<boolean> {
  const enabled = await getSparkJobWatcherEnabled();
  return pushWatcherToPlatform(enabled);
}

async function readAdminSettings(): Promise<{
  sparkJobWatcherEnabled: boolean;
  clusterSynced: boolean;
}> {
  const sparkJobWatcherEnabled = await getSparkJobWatcherEnabled();
  const clusterSynced = await pushWatcherToPlatform(sparkJobWatcherEnabled);
  return { sparkJobWatcherEnabled, clusterSynced };
}

module.exports = {
  getSparkJobWatcherEnabled,
  setSparkJobWatcherEnabled,
  syncSparkJobWatcherToPlatform,
  readAdminSettings,
};
