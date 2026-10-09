'use strict';

/**
 * Lab visibility + tokens live in the pack JSON (`visibleTo`, `tokens`) so a
 * deploy carries them to every environment. Environments with
 * CATALOG_SETTINGS_LOCKED=true (EC2) treat packs as read-only and reject edits.
 */

const fs = require('fs');
const path = require('path');

const PACKS_DIR = path.join(__dirname, 'packs');

function catalogSettingsLocked(): boolean {
  return String(process.env.CATALOG_SETTINGS_LOCKED || '').trim().toLowerCase() === 'true';
}

function packPathFor(challengeId: string): string | null {
  if (!fs.existsSync(PACKS_DIR)) return null;
  const direct = path.join(PACKS_DIR, `${challengeId}.json`);
  if (fs.existsSync(direct)) return direct;
  for (const f of fs.readdirSync(PACKS_DIR) as string[]) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(PACKS_DIR, f);
    try {
      if (JSON.parse(fs.readFileSync(full, 'utf8')).id === challengeId) return full;
    } catch {
      /* skip unreadable pack */
    }
  }
  return null;
}

function writePackSettings(
  challengeId: string,
  settings: { visibleTo?: string; tokens?: number },
): boolean {
  const file = packPathFor(challengeId);
  if (!file) return false;
  const text = fs.readFileSync(file, 'utf8');
  const raw = JSON.parse(text);
  if (settings.visibleTo != null) raw.visibleTo = settings.visibleTo;
  if (settings.tokens != null) raw.tokens = settings.tokens;
  let out = JSON.stringify(raw, null, 2);
  // Keep \uXXXX-escaped packs escaped so the diff is only the changed keys.
  if (!/[^\x00-\x7f]/.test(text)) {
    out = out.replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  }
  fs.writeFileSync(file, `${out}\n`);
  return true;
}

module.exports = { catalogSettingsLocked, writePackSettings };
