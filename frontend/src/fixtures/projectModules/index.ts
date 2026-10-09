/**
 * Registry of authored module content.
 *
 * `constants/projects.ts` is the plan — every chapter a project will ship. This
 * is what actually exists. A chapter marked `ready` there must have an entry
 * here, and `hasModuleContent` is what the UI trusts when it decides whether a
 * chapter opens or stays locked.
 *
 * Cinder V0.1: chapters are authored one at a time. The scratch repo in each
 * fixture only contains files that chapter needs; later chapters add paths.
 * Do not register a full memkv tree in chapter 1.
 */

import { TCP_SERVER_MINOR } from './tcpServerMinor';
import { LSM_TREE_MEMTABLE_CPP, LSM_TREE_MEMTABLE_GO, LSM_TREE_MEMTABLE_PYTHON } from './lsmTreeMinor';
import { LSM_TREE_OVERVIEW } from './lsmTreeOverview';
import { CINDER_EVENT_LOOP } from './cinderEventLoop';
import type { LanguageId } from '../../constants/languages';
import type { ChapterReading, ProjectModuleContent } from './types';

export type { ChapterReading, ModuleTask, ProjectModuleContent } from './types';

/** Cinder chapter fixtures land here as each chapter is authored. */
const MODULE_CONTENT: ProjectModuleContent[] = [CINDER_EVENT_LOOP];

/** Single-workspace minors, keyed by minor id. */
const MINOR_CONTENT: ProjectModuleContent[] = [TCP_SERVER_MINOR];

/**
 * Chapters of chaptered minors: `projectId` is the minor id, `moduleId` the
 * chapter id, and `language` which port it is (Go when unset).
 */
const MINOR_CHAPTER_CONTENT: ProjectModuleContent[] = [
  LSM_TREE_MEMTABLE_GO,
  LSM_TREE_MEMTABLE_PYTHON,
  LSM_TREE_MEMTABLE_CPP,
];

const DEFAULT_LANGUAGE: LanguageId = 'go';

const BY_KEY = new Map<string, ProjectModuleContent>(
  MODULE_CONTENT.map((m) => [`${m.projectId}/${m.moduleId}`, m]),
);

const MINOR_BY_ID = new Map<string, ProjectModuleContent>(
  MINOR_CONTENT.map((m) => [m.moduleId, m]),
);

const MINOR_CHAPTER_BY_KEY = new Map<string, ProjectModuleContent>(
  MINOR_CHAPTER_CONTENT.map((m) => [
    `${m.projectId}/${m.moduleId}/${m.language || DEFAULT_LANGUAGE}`,
    m,
  ]),
);

/** Articles for `reading` chapters of minors, keyed `minorId/chapterId`. */
const MINOR_READINGS = new Map<string, ChapterReading>([['lsm-tree/overview', LSM_TREE_OVERVIEW]]);

export function getModuleContent(
  projectId: string | null | undefined,
  moduleId: string | null | undefined,
): ProjectModuleContent | null {
  if (!projectId || !moduleId) return null;
  return BY_KEY.get(`${projectId}/${moduleId}`) || null;
}

export function hasModuleContent(
  projectId: string | null | undefined,
  moduleId: string | null | undefined,
): boolean {
  return getModuleContent(projectId, moduleId) != null;
}

export function getMinorContent(minorId: string | null | undefined): ProjectModuleContent | null {
  if (!minorId) return null;
  return MINOR_BY_ID.get(minorId) || null;
}

export function hasMinorContent(minorId: string | null | undefined): boolean {
  return getMinorContent(minorId) != null;
}

export function getMinorChapterContent(
  minorId: string | null | undefined,
  chapterId: string | null | undefined,
  language: LanguageId = DEFAULT_LANGUAGE,
): ProjectModuleContent | null {
  if (!minorId || !chapterId) return null;
  return MINOR_CHAPTER_BY_KEY.get(`${minorId}/${chapterId}/${language}`) || null;
}

export function hasMinorChapterContent(
  minorId: string | null | undefined,
  chapterId: string | null | undefined,
  language: LanguageId = DEFAULT_LANGUAGE,
): boolean {
  return getMinorChapterContent(minorId, chapterId, language) != null;
}

export function getMinorReading(
  minorId: string | null | undefined,
  chapterId: string | null | undefined,
): ChapterReading | null {
  if (!minorId || !chapterId) return null;
  return MINOR_READINGS.get(`${minorId}/${chapterId}`) || null;
}
