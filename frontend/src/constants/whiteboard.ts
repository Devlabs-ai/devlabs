/** Whiteboard — data systems theory boards. No cluster; order the mechanism. */

export const WHITEBOARD_PATH = '/track/whiteboard';

export interface WhiteboardSection {
  id: string;
  label: string;
  blurb: string;
  matchTags: string[];
}

export const WHITEBOARD_SECTIONS: WhiteboardSection[] = [
  {
    id: 'storage',
    label: 'Storage engines',
    blurb: 'Logs, memtables, SSTables, B-trees — what happens between a write and the disk.',
    matchTags: ['storage-engines'],
  },
  {
    id: 'replication',
    label: 'Replication',
    blurb: 'Leaders, followers, lag and failover — keeping copies in step when nodes die.',
    matchTags: ['replication'],
  },
  {
    id: 'partitioning',
    label: 'Partitioning',
    blurb: 'Spreading data across nodes, and moving it again without downtime.',
    matchTags: ['partitioning'],
  },
  {
    id: 'transactions',
    label: 'Transactions',
    blurb: 'Atomic commit and isolation — all or nothing, even across machines.',
    matchTags: ['transactions'],
  },
  {
    id: 'consensus',
    label: 'Consensus',
    blurb: 'Elections, terms and majorities — getting nodes to agree on one history.',
    matchTags: ['consensus'],
  },
  {
    id: 'streams',
    label: 'Stream processing',
    blurb: 'Checkpoints, barriers and transactional sinks — exactly-once, explained.',
    matchTags: ['streams'],
  },
  {
    id: 'experiments',
    label: 'Experiments',
    blurb: 'Six takes on the LSM write path — different stories, different games. Pick the one that clicks.',
    matchTags: ['board-experiment'],
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
