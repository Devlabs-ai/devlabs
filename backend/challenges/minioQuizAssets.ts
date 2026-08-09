'use strict';

/**
 * Load published quizzes from MinIO (sole runtime SSOT).
 *
 * Layout (from publish-quiz.sh):
 *   quizzes/<id>/quiz.json
 *   quizzes/<id>/metadata.json   # exhibit historyAppId / historyUrl
 *   quizzes/<id>/questions.json
 *   quizzes/<id>/exhibit/src/main.py
 *   quizzes/<id>/manifest.json
 */

const { getObjectStore, normalizeKey } = require('../workspace/objectStore');

const HISTORY_UI_FALLBACK = (process.env.SPARK_HISTORY_UI_URL || '')
  .replace(/\/$/, '') || null;

export type QuizQuestion = {
  id: string;
  section?: string;
  type: 'mcq' | 'number' | 'true_false' | string;
  prompt: string;
  choices?: string[];
  correctAnswer: string | number | boolean;
  explanation?: string;
  requiresHistory?: boolean;
  historyHint?: string;
};

export type QuizPublic = {
  id: string;
  title: string;
  kind: 'quiz';
  learningOutcome: string;
  difficulty?: string;
  tags?: string[];
  panelLabel: string;
  domainId: string;
  passScore: number;
  sideQuest: { title: string; subtitle: string };
  exhibit: {
    submissionId: string;
    historyAppId: string | null;
    historyUrl: string | null;
    codePath: string;
    code: string;
  };
  questions: QuizQuestion[];
};

export type QuizListItem = {
  id: string;
  title: string;
  kind: 'quiz';
  learningOutcome: string;
  difficulty?: string;
  tags?: string[];
  panelLabel: string;
  domainId: string;
  sideQuest: { title: string; subtitle: string };
};

function quizMissing(quizId: string, what: string): Error {
  const e = new Error(
    `${what} missing in MinIO for ${quizId}. Expected under quizzes/${quizId}/. Re-run ./bin/publish-quiz.sh ${quizId}.`,
  );
  (e as Error & { status?: number }).status = 503;
  return e;
}

async function readJson(key: string): Promise<unknown | null> {
  const store = getObjectStore();
  const buf = await store.getObject(normalizeKey(key));
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

async function readText(key: string): Promise<string | null> {
  const store = getObjectStore();
  const buf = await store.getObject(normalizeKey(key));
  if (!buf) return null;
  return buf.toString('utf8');
}

function panelLabelFrom(meta: Record<string, unknown>): string {
  const play = (meta.play || {}) as { panelId?: string };
  const panelId = play.panelId || 'spark';
  if (panelId === 'spark') return 'Spark';
  return panelId;
}

function domainIdFrom(meta: Record<string, unknown>): string {
  const play = (meta.play || {}) as { domainId?: string };
  return play.domainId || 'data-engineer';
}

function sideQuestFrom(meta: Record<string, unknown>): { title: string; subtitle: string } {
  const sq = meta.sideQuest as { title?: string; subtitle?: string } | undefined;
  if (sq?.title && sq?.subtitle) return { title: sq.title, subtitle: sq.subtitle };
  const title = typeof meta.title === 'string' ? meta.title : 'Quiz';
  return { title: 'Side Quest', subtitle: title };
}

async function listQuizIdsFromMinio(): Promise<string[]> {
  const store = getObjectStore();
  const keys: string[] = await store.listKeys('quizzes/');
  const ids = new Set<string>();
  for (const key of keys) {
    const m = key.match(/^quizzes\/([^/]+)\/quiz\.json$/);
    if (m) ids.add(m[1]);
  }
  return [...ids].sort();
}

async function loadQuizMeta(quizId: string): Promise<Record<string, unknown> | null> {
  const raw = await readJson(`quizzes/${quizId}/quiz.json`);
  if (!raw || typeof raw !== 'object') return null;
  const meta = raw as Record<string, unknown>;
  if (meta.kind !== 'quiz') return null;
  return meta;
}

async function listQuizzesFromMinio(): Promise<QuizListItem[]> {
  const ids = await listQuizIdsFromMinio();
  const out: QuizListItem[] = [];
  for (const id of ids) {
    const meta = await loadQuizMeta(id);
    if (!meta) continue;
    out.push({
      id,
      title: String(meta.title || id),
      kind: 'quiz',
      learningOutcome: String(meta.learningOutcome || ''),
      difficulty: typeof meta.difficulty === 'string' ? meta.difficulty : undefined,
      tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : undefined,
      panelLabel: panelLabelFrom(meta),
      domainId: domainIdFrom(meta),
      sideQuest: sideQuestFrom(meta),
    });
  }
  return out;
}

async function loadQuizFromMinio(quizId: string): Promise<QuizPublic> {
  if (!quizId) throw quizMissing(quizId, 'Quiz id');

  const meta = await loadQuizMeta(quizId);
  if (!meta) throw quizMissing(quizId, 'quiz.json (kind=quiz)');

  const questionsDoc = (await readJson(`quizzes/${quizId}/questions.json`)) as {
    questions?: QuizQuestion[];
    passScore?: number;
    learningOutcome?: string;
  } | null;
  if (!questionsDoc?.questions?.length) {
    throw quizMissing(quizId, 'questions.json');
  }

  const quizMeta = (await readJson(`quizzes/${quizId}/metadata.json`)) as {
    submissionId?: string;
    historyAppId?: string | null;
    historyUrl?: string | null;
  } | null;

  const platformSpec = (meta.platformSpec || {}) as Record<string, unknown>;
  const codePath =
    typeof platformSpec.exhibitCodeKey === 'string'
      ? String(platformSpec.exhibitCodeKey).replace(/^quizzes\/[^/]+\//, '')
      : 'exhibit/src/main.py';
  const codeKey = codePath.startsWith('quizzes/')
    ? codePath
    : `quizzes/${quizId}/${codePath.replace(/^\//, '')}`;
  const code =
    (await readText(`quizzes/${quizId}/exhibit/src/main.py`)) ||
    (await readText(codeKey));
  if (!code) throw quizMissing(quizId, 'exhibit/src/main.py');

  const passScore =
    typeof questionsDoc.passScore === 'number'
      ? questionsDoc.passScore
      : typeof platformSpec.passScore === 'number'
        ? (platformSpec.passScore as number)
        : 0.8;

  const historyAppId =
    quizMeta?.historyAppId == null || quizMeta.historyAppId === ''
      ? null
      : String(quizMeta.historyAppId);
  const historyUrlRaw =
    quizMeta?.historyUrl == null || quizMeta.historyUrl === ''
      ? null
      : String(quizMeta.historyUrl);
  const historyUrl =
    historyUrlRaw ||
    (historyAppId && HISTORY_UI_FALLBACK
      ? `${HISTORY_UI_FALLBACK}/history/${encodeURIComponent(historyAppId)}`
      : null);

  return {
    id: quizId,
    title: String(meta.title || quizId),
    kind: 'quiz',
    learningOutcome: String(
      meta.learningOutcome || questionsDoc.learningOutcome || '',
    ),
    difficulty: typeof meta.difficulty === 'string' ? meta.difficulty : undefined,
    tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : undefined,
    panelLabel: panelLabelFrom(meta),
    domainId: domainIdFrom(meta),
    passScore,
    sideQuest: sideQuestFrom(meta),
    exhibit: {
      submissionId: String(quizMeta?.submissionId || `frozen-${quizId}`),
      historyAppId,
      historyUrl,
      codePath: 'src/main.py',
      code,
    },
    questions: questionsDoc.questions,
  };
}

module.exports = {
  listQuizzesFromMinio,
  loadQuizFromMinio,
};
