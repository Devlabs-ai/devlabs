'use strict';

const pool = require('../db/pool');

const WATCHER_KEY = 'spark_job_watcher_enabled';
const REGISTRATION_OPEN_KEY = 'registration_open';
const PLATFORM_API =
  process.env.SPARK_PLATFORM_API_URL || 'http://192.168.1.2:30088';

function parseEnabled(raw: unknown, fallback = true): boolean {
  if (raw == null) return fallback;
  const s = String(raw).trim().toLowerCase();
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  return fallback;
}

async function getMetaBool(key: string, fallback: boolean): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT value FROM app_meta WHERE key = $1`,
    [key],
  );
  return parseEnabled(rows[0]?.value, fallback);
}

async function setMetaBool(key: string, enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, enabled ? 'true' : 'false'],
  );
}

async function getSparkJobWatcherEnabled(): Promise<boolean> {
  return getMetaBool(WATCHER_KEY, true);
}

async function saveSparkJobWatcherEnabled(enabled: boolean): Promise<void> {
  await setMetaBool(WATCHER_KEY, enabled);
}

async function getRegistrationOpen(): Promise<boolean> {
  // Default open so Google / first-run sign-in works without a seeded admin approving.
  return getMetaBool(REGISTRATION_OPEN_KEY, true);
}

async function setRegistrationOpen(enabled: boolean): Promise<boolean> {
  await setMetaBool(REGISTRATION_OPEN_KEY, enabled);
  return enabled;
}

async function pushWatcherToPlatform(enabled: boolean): Promise<boolean> {
  const url = `${PLATFORM_API.replace(/\/$/, '')}/api/watcher`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
      signal: AbortSignal.timeout(4000),
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

/** DB-only read — never blocks on the Spark cluster (that made the admin page hang). */
async function readAdminSettings(): Promise<{
  sparkJobWatcherEnabled: boolean;
  clusterSynced: boolean;
  registrationOpen: boolean;
}> {
  const [sparkJobWatcherEnabled, registrationOpen] = await Promise.all([
    getSparkJobWatcherEnabled(),
    getRegistrationOpen(),
  ]);
  return {
    sparkJobWatcherEnabled,
    registrationOpen,
    // Unknown until a watcher toggle actually pushes; don't probe on page load.
    clusterSynced: true,
  };
}

async function updateAdminSettings(patch: {
  sparkJobWatcherEnabled?: boolean;
  registrationOpen?: boolean;
}): Promise<{
  sparkJobWatcherEnabled: boolean;
  clusterSynced: boolean;
  registrationOpen: boolean;
}> {
  let clusterSynced = true;

  if (typeof patch.sparkJobWatcherEnabled === 'boolean') {
    const result = await setSparkJobWatcherEnabled(patch.sparkJobWatcherEnabled);
    clusterSynced = result.clusterSynced;
  }

  if (typeof patch.registrationOpen === 'boolean') {
    await setRegistrationOpen(patch.registrationOpen);
  }

  const [sparkJobWatcherEnabled, registrationOpen] = await Promise.all([
    getSparkJobWatcherEnabled(),
    getRegistrationOpen(),
  ]);

  return {
    sparkJobWatcherEnabled,
    registrationOpen,
    clusterSynced,
  };
}

module.exports = {
  getSparkJobWatcherEnabled,
  setSparkJobWatcherEnabled,
  syncSparkJobWatcherToPlatform,
  getRegistrationOpen,
  setRegistrationOpen,
  readAdminSettings,
  updateAdminSettings,
};
