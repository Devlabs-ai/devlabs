/** Minors — small independent builds. A major may point at one; the reverse is not required. */

import type { LanguageId } from './languages';
import type { ProjectModule } from './projects';

export const MINORS_PATH = '/minors';

export interface MinorEntry {
  id: string;
  name: string;
  subtitle: string;
  blurb: string;
  about: string[];
  language?: string;
  facts: string[];
  status: 'ready' | 'planned';
  /**
   * Chaptered minors list their chapters here and open on a chapter list, like a
   * major. Minors without chapters open straight into one workspace.
   */
  chapters?: ProjectModule[];
  /**
   * Languages the build chapters are authored in, default first. Learners pick
   * one on the chapter list; each language keeps its own saved progress.
   */
  languages?: LanguageId[];
}

const LSM_TREE_CHAPTERS: ProjectModule[] = [
  {
    id: 'overview',
    label: 'Overview',
    subtitle: 'What an LSM tree is, where it runs, and what you will build',
    blurb:
      'Why databases buffer writes and merge sorted files instead of updating in place, which systems run on LSM trees, and the five chapters ahead.',
    status: 'ready',
    kind: 'reading',
  },
  {
    id: 'memtable',
    label: 'Memtable',
    subtitle: 'A skiplist, tombstones, and ordered scans',
    blurb:
      'The sorted in-memory buffer every write lands in. Deletes are writes, and a lookup answers found, deleted, or missing.',
    status: 'ready',
  },
  {
    id: 'write-ahead-log',
    label: 'Write-ahead log',
    subtitle: 'Append before acknowledging, replay on open',
    blurb:
      'Checksummed records, an fsync policy, and a torn tail truncated on recovery. Kill the process mid-write and lose nothing acknowledged.',
    status: 'planned',
  },
  {
    id: 'sstable',
    label: 'SSTable',
    subtitle: 'Flush the memtable to a sorted, immutable file',
    blurb:
      'Data blocks, an index block, and a checksummed footer. A point lookup reads one block, not the whole file.',
    status: 'planned',
  },
  {
    id: 'read-path',
    label: 'Read path',
    subtitle: 'Bloom filters and newest-first search',
    blurb:
      'Memtable first, then tables from newest to oldest. Bloom filters skip files that cannot hold the key; a merging iterator serves range scans.',
    status: 'planned',
  },
  {
    id: 'compaction',
    label: 'Compaction',
    subtitle: 'Merge tables, drop dead versions',
    blurb:
      'A k-way merge keeps the newest version of each key, drops tombstones with nothing left to hide, and swaps files atomically through a manifest.',
    status: 'planned',
  },
];

export const MINORS: MinorEntry[] = [
  {
    id: 'tcp-server',
    name: 'TCP server',
    subtitle: 'Building a TCP server',
    blurb:
      'Bind a listener, accept clients, and serve a line protocol you can talk to with nc.',
    about: [
      'A TCP server is a listening socket, an accept loop, and a connection handler that reads requests and writes replies. By the end you have a process that answers PING over the network.',
      'You implement listen, accept, the per-connection read loop, and graceful shutdown. The protocol is one request per line: PING, ECHO, QUIT. Tests dial a real port — passing them means the socket path actually works.',
    ],
    facts: ['Sockets', 'Accept loop', 'Line protocol'],
    status: 'planned',
  },
  {
    id: 'lsm-tree',
    name: 'LSM tree',
    subtitle: 'Building an LSM storage engine',
    blurb:
      'The write-optimized engine behind RocksDB and Cassandra: a memtable, a write-ahead log, sorted tables on disk, and compaction.',
    about: [
      'An LSM tree turns random writes into sequential ones. Writes land in a sorted in-memory memtable, backed by a write-ahead log so a crash loses nothing. A full memtable is flushed to disk as an immutable sorted file, an SSTable.',
      'Reads check the memtable, then tables from newest to oldest, with Bloom filters skipping files that cannot hold the key. Compaction merges tables in the background, keeping the newest version of each key and dropping deleted data. Each chapter ends with tests that prove that piece works.',
    ],
    language: 'Go · Python · C++',
    facts: [
      'Skiplist',
      'SSTables',
      'Compaction',
      `${LSM_TREE_CHAPTERS.filter((c) => c.kind !== 'reading').length} chapters`,
    ],
    status: 'planned',
    chapters: LSM_TREE_CHAPTERS,
    languages: ['go', 'python', 'cpp'],
  },
];

export function getMinor(id: string | null | undefined): MinorEntry | null {
  if (!id) return null;
  return MINORS.find((m) => m.id === id) || null;
}

export function getMinorChapter(
  minor: MinorEntry | null | undefined,
  chapterId: string | null | undefined,
): ProjectModule | null {
  if (!minor?.chapters || !chapterId) return null;
  return minor.chapters.find((c) => c.id === chapterId) || null;
}

export function minorsFor(ids: string[] | undefined): MinorEntry[] {
  if (!ids || ids.length === 0) return [];
  return ids.map((id) => getMinor(id)).filter((m): m is MinorEntry => m != null);
}
