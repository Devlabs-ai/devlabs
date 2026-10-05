import type { ReadingTrackId } from '../constants/readingTracks';

export type ReadingCurationEntry = {
  note: string;
  updatedAt: string;
};

export type ReadingCurationState = Record<string, ReadingCurationEntry>;

const STORAGE_PREFIX = 'devsetu_reading_curation:v2';

function storageKey(trackId: ReadingTrackId, readingSlug: string): string {
  return `${STORAGE_PREFIX}:${trackId}:${readingSlug}`;
}

function normalizeEntry(raw: unknown): ReadingCurationEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { note?: unknown; updatedAt?: unknown };
  const note = typeof o.note === 'string' ? o.note : '';
  if (!note.trim()) return null;
  return {
    note,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
  };
}

export function loadReadingCuration(
  trackId: ReadingTrackId,
  readingSlug: string,
): ReadingCurationState {
  if (typeof window === 'undefined') return {};
  const merged: ReadingCurationState = {};
  const keys = [
    storageKey(trackId, readingSlug),
    `devsetu_reading_curation:v1:${trackId}:${readingSlug}`,
  ];
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') continue;
      for (const [blockId, entryRaw] of Object.entries(parsed)) {
        const entry = normalizeEntry(entryRaw);
        if (entry) merged[blockId] = entry;
      }
    } catch {
      /* ignore corrupt storage */
    }
  }
  return merged;
}

export function saveReadingCuration(
  trackId: ReadingTrackId,
  readingSlug: string,
  state: ReadingCurationState,
): void {
  if (typeof window === 'undefined') return;
  const key = storageKey(trackId, readingSlug);
  const hasAny = Object.values(state).some((e) => e.note.trim());
  if (!hasAny) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(state));
}

export function countReadingCuration(state: ReadingCurationState): { notes: number } {
  let notes = 0;
  for (const entry of Object.values(state)) {
    if (entry.note.trim()) notes += 1;
  }
  return { notes };
}
