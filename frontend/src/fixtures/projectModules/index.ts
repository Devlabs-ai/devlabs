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
import { CINDER_EVENT_LOOP } from './cinderEventLoop';
import type { ProjectModuleContent } from './types';

export type { ModuleTask, ProjectModuleContent } from './types';

/** Cinder chapter fixtures land here as each chapter is authored. */
const MODULE_CONTENT: ProjectModuleContent[] = [CINDER_EVENT_LOOP];

const MINOR_CONTENT: ProjectModuleContent[] = [TCP_SERVER_MINOR];

const BY_KEY = new Map<string, ProjectModuleContent>(
  MODULE_CONTENT.map((m) => [`${m.projectId}/${m.moduleId}`, m]),
);

const MINOR_BY_ID = new Map<string, ProjectModuleContent>(
  MINOR_CONTENT.map((m) => [m.moduleId, m]),
);

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
