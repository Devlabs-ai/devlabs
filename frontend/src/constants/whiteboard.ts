/** Whiteboard — internals boards, separate from graded Spark labs. */

export const WHITEBOARD_PATH = '/play/whiteboard';

export interface WhiteboardSection {
  id: string;
  label: string;
  blurb: string;
  matchTags: string[];
}

export const WHITEBOARD_SECTIONS: WhiteboardSection[] = [
  {
    id: 'spark',
    label: 'Spark',
    blurb: 'Fill empty blocks on the physical plan — operators from Unused, not a DAG from scratch.',
    matchTags: ['spark'],
  },
];

export function whiteboardSectionPath(sectionId: string): string {
  return `${WHITEBOARD_PATH}/${sectionId}`;
}

export function getWhiteboardSection(sectionId: string | null | undefined): WhiteboardSection | null {
  if (!sectionId) return null;
  return WHITEBOARD_SECTIONS.find((s) => s.id === sectionId) || null;
}

export function whiteboardSectionForTags(tags?: string[] | null): WhiteboardSection {
  const lower = (tags || []).map((t) => t.toLowerCase());
  return (
    WHITEBOARD_SECTIONS.find((s) => s.matchTags.some((tag) => lower.includes(tag)))
    || WHITEBOARD_SECTIONS[0]
  );
}

export function challengeMatchesWhiteboardSection(
  tags: string[] | undefined,
  section: WhiteboardSection,
): boolean {
  const lower = (tags || []).map((t) => t.toLowerCase());
  if (section.matchTags.some((tag) => lower.includes(tag))) return true;
  // Untagged boards still belong on the first shelf so nothing is orphaned.
  if (section.id === WHITEBOARD_SECTIONS[0]?.id) {
    return !WHITEBOARD_SECTIONS.some((s) =>
      s.id !== section.id && s.matchTags.some((tag) => lower.includes(tag)),
    );
  }
  return false;
}
