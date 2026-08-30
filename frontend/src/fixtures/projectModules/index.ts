/**
 * Registry of authored module content.
 *
 * `constants/projects.ts` is the plan — every module a project will ship. This
 * is what actually exists. A module marked `ready` there must have an entry
 * here, and `hasModuleContent` is what the UI trusts when it decides whether a
 * module opens or renders as locked.
 */

import { TCP_SERVER_MINOR } from './tcpServerMinor';
import { CINDER_EVENT_LOOP } from './cinderEventLoop';
import type { ProjectModuleContent } from './types';

export type { ModuleTask, ProjectModuleContent } from './types';

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
