'use strict';

/**
 * Load published challenge meta + starter/solution files from MinIO (contentSource=minio).
 *
 * Layout:
 *   challenges/<id>/challenge/challenge.json
 *   challenges/<id>/starter/**
 *   challenges/<id>/solution/**
 *
 * For MinIO SSOT labs, open-challenge payloads are built from MinIO only.
 * Postgres is used only to know the challenge exists (thin catalog).
 */

const { getObjectStore, normalizeKey } = require('../workspace/objectStore');

export type ChallengeMeta = {
  id: string;
  /** Global catalog number across all platforms. */
  number?: number | null;
  title?: string;
  description?: string;
  difficulty?: string;
  tags?: string[];
  category?: string;
  sandboxType?: string;
  contentSource?: string;
  problemStatement?: Record<string, unknown>;
  platformSpec?: Record<string, unknown>;
  [key: string]: unknown;
};

function challengePrefix(challengeId: string): string {
  return normalizeKey(`challenges/${challengeId}`);
}

function minioMissingError(challengeId: string, what: string): Error {
  const e = new Error(
    `${what} missing in MinIO for ${challengeId}. Expected under challenges/${challengeId}/. Re-publish the challenge.`,
  );
  (e as Error & { status?: number }).status = 503;
  return e;
}

async function loadChallengeMeta(challengeId: string): Promise<ChallengeMeta | null> {
  if (!challengeId) return null;
  const store = getObjectStore();
  const key = `${challengePrefix(challengeId)}/challenge/challenge.json`;
  const buf = await store.getObject(key);
  if (!buf) return null;
  try {
    const meta = JSON.parse(buf.toString('utf8')) as ChallengeMeta;
    if (!meta || typeof meta !== 'object') return null;
    return meta;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[minioChallengeAssets] bad challenge.json for ${challengeId}: ${msg}`);
    return null;
  }
}

async function loadPrefixFiles(
  challengeId: string,
  folder: 'starter' | 'solution',
  opts?: { skipRel?: (rel: string) => boolean },
): Promise<Record<string, string> | null> {
  if (!challengeId) return null;
  const store = getObjectStore();
  const prefix = `${challengePrefix(challengeId)}/${folder}/`;
  const keys: string[] = await store.listKeys(prefix);
  if (!keys.length) return null;

  const files: Record<string, string> = {};
  for (const key of keys) {
    if (key.endsWith('/')) continue;
    const rel = key.slice(prefix.length);
    if (!rel || rel.includes('..')) continue;
    if (rel.includes('__pycache__') || rel.endsWith('.pyc')) continue;
    if (opts?.skipRel?.(rel)) continue;
    const buf = await store.getObject(key);
    if (!buf) continue;
    files[rel] = buf.toString('utf8');
  }
  return Object.keys(files).length ? files : null;
}

async function loadStarterFiles(challengeId: string): Promise<Record<string, string> | null> {
  return loadPrefixFiles(challengeId, 'starter');
}

/** Student-facing reference solution (Spark entry + docs). Skips package dunders / oracle helper. */
async function loadSolutionFiles(challengeId: string): Promise<Record<string, string> | null> {
  return loadPrefixFiles(challengeId, 'solution', {
    skipRel: (rel) => {
      const base = rel.split('/').pop() || rel;
      if (base === '__init__.py') return true;
      // Data-gen oracle — not the Play reference solution.
      if (base === 'solve.py') return true;
      return false;
    },
  });
}

function catalogWantsMinio(base: Record<string, unknown>): boolean {
  if (base.contentSource === 'minio') return true;
  const platform = base.sparkPlatform as { contentSource?: string } | null | undefined;
  return platform?.contentSource === 'minio';
}

/** Build open-challenge payload from MinIO meta only (Postgres thin fields for flags). */
function challengeFromMinioMeta(
  meta: ChallengeMeta,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const platformSpec = { ...(meta.platformSpec || {}) } as Record<string, unknown>;
  const contentSource =
    meta.contentSource
    || (platformSpec.contentSource as string | undefined)
    || 'minio';
  platformSpec.contentSource = contentSource;

  const problemStatement = { ...(meta.problemStatement || {}) } as Record<string, unknown>;

  const number =
    typeof meta.number === 'number' && Number.isFinite(meta.number)
      ? Math.trunc(meta.number)
      : (typeof base.number === 'number' ? base.number : null);

  return {
    id: meta.id || base.id,
    number,
    title: meta.title ?? base.title,
    description: meta.description ?? '',
    difficulty: meta.difficulty ?? base.difficulty,
    tags: meta.tags ?? base.tags ?? [],
    category: meta.category ?? base.category,
    finalized: base.finalized ?? true,
    sandboxType: meta.sandboxType ?? base.sandboxType,
    contentSource,
    verifiedDir: base.verifiedDir ?? null,
    // Intentionally from MinIO only — do not fall back to Postgres problem_statement.
    problemStatement,
    validationSpec: null,
    sparkPlatform: platformSpec,
  };
}

/**
 * Open a challenge for Play detail / session.
 * - contentSource=minio: require MinIO challenge.json; body from MinIO only
 * - legacy: prefer MinIO if present, else Postgres base
 */
async function hydrateChallengeFromMinio(
  base: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  if (!base || typeof base.id !== 'string') return base;
  if ((base.sandboxType as string | undefined) === 'board') return base;

  const meta = await loadChallengeMeta(base.id);
  const wantsMinio = catalogWantsMinio(base)
    || meta?.contentSource === 'minio'
    || (meta?.platformSpec as { contentSource?: string } | undefined)?.contentSource === 'minio';

  if (wantsMinio) {
    if (!meta) {
      throw minioMissingError(base.id, 'challenge/challenge.json');
    }
    return challengeFromMinioMeta(meta, base);
  }

  if (meta) {
    return challengeFromMinioMeta(meta, base);
  }
  return base;
}

function safeRelPath(rel: string): string | null {
  const t = String(rel || '').replace(/^\/+/, '').replace(/\\/g, '/');
  if (!t || t.includes('..')) return null;
  const parts = t.split('/');
  if (parts.some((p) => !p || p === '.')) return null;
  return t;
}

async function writeChallengeMeta(meta: ChallengeMeta): Promise<void> {
  if (!meta?.id) throw new Error('challenge meta missing id');
  const store = getObjectStore();
  const prefix = challengePrefix(meta.id);
  await store.putObject(
    `${prefix}/challenge/challenge.json`,
    `${JSON.stringify(meta, null, 2)}\n`,
    'application/json',
  );
  if (typeof meta.description === 'string') {
    const title = String(meta.title || meta.id);
    const body = meta.description.replace(/^\s+/, '').replace(/\s+$/, '');
    const md = `# ${title}\n\n${body}\n`;
    await store.putObject(
      `${prefix}/challenge/description.md`,
      md,
      'text/markdown; charset=utf-8',
    );
  }
  if (meta.platformSpec && typeof meta.platformSpec === 'object') {
    await store.putObject(
      `${prefix}/challenge/platform-spec.json`,
      `${JSON.stringify(meta.platformSpec, null, 2)}\n`,
      'application/json',
    );
  }
}

async function writeSolutionFiles(
  challengeId: string,
  files: Record<string, string>,
): Promise<Record<string, string>> {
  const store = getObjectStore();
  const prefix = `${challengePrefix(challengeId)}/solution/`;
  const written: Record<string, string> = {};
  for (const [rawPath, rawBody] of Object.entries(files || {})) {
    const rel = safeRelPath(rawPath);
    if (!rel) continue;
    const body = typeof rawBody === 'string' ? rawBody : String(rawBody ?? '');
    await store.putObject(`${prefix}${rel}`, body, 'text/plain; charset=utf-8');
    written[rel] = body;
  }
  return written;
}

function stripMoat(challenge: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!challenge || typeof challenge !== 'object') return challenge ?? null;
  const ps = challenge.problemStatement;
  if (!ps || typeof ps !== 'object' || Array.isArray(ps) || !('moat' in (ps as object))) {
    return challenge;
  }
  const nextPs = { ...(ps as Record<string, unknown>) };
  delete nextPs.moat;
  return { ...challenge, problemStatement: nextPs };
}

/** Learners never see setter notes. Admins (or open lab with no ADMIN_EMAILS) do. */
function applyMoatPolicy(
  challenge: Record<string, unknown> | null | undefined,
  user: { sub?: string; userId?: string; email?: string } | null | undefined,
): Record<string, unknown> | null {
  const { isAdminUser } = require('../auth/middleware');
  if (isAdminUser(user)) return challenge ?? null;
  return stripMoat(challenge);
}

module.exports = {
  loadChallengeMeta,
  loadStarterFiles,
  loadSolutionFiles,
  hydrateChallengeFromMinio,
  challengePrefix,
  challengeFromMinioMeta,
  writeChallengeMeta,
  writeSolutionFiles,
  stripMoat,
  applyMoatPolicy,
};
