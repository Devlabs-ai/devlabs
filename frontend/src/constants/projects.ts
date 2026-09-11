/** Majors — multi-stage builds you carry from an empty repo to a working system. */

export const MAJORS_PATH = '/play/majors';
/** @deprecated Use MAJORS_PATH */
export const PROJECTS_PATH = MAJORS_PATH;

/**
 * A module is one chapter: theory on the left, a scratch repo on the right that
 * grows file-by-file across chapters. `ready` chapters have authored content in
 * `fixtures/projectModules`; `planned` ones are the roadmap and render locked.
 *
 * Authoring rule (Cinder V0.1): chapter N only ships the files that chapter
 * needs. Later packages appear as new placeholders when their chapter lands.
 * Process wiring (logger, cmd/server, Makefile) is updated by authors across
 * chapters — not a student TODO dump in chapter 1.
 */
export interface ProjectModule {
  id: string;
  label: string;
  /** One line on what gets built in this module. */
  subtitle: string;
  blurb: string;
  status: 'ready' | 'planned';
  /** Independent minors this module assumes or points at. */
  minors?: string[];
}

export interface ProjectEntry {
  id: string;
  /** Short product name shown as the tile title. */
  name: string;
  /** What the build actually is, in plain words. */
  subtitle: string;
  blurb: string;
  /** Unlabeled description of the finished system. */
  about: string[];
  level: 'Intermediate' | 'Advanced';
  language: string;
  /** Short facts rendered as chips on the tile. */
  facts: string[];
  /** Independent minors this project points at. */
  minors?: string[];
  /** `ready` majors are open; `planned` ones render as coming soon. */
  status: 'ready' | 'planned';
  modules: ProjectModule[];
}

/**
 * Cinder V0.1 — single-threaded KV store in Go.
 *
 * Chapters grow an empty scratch repo. No pub/sub or streams in this pass.
 * Reference implementation: memkv tag v0.1.0.
 */
const CINDER_MODULES: ProjectModule[] = [
  {
    id: 'event-loop',
    label: 'Event loop',
    subtitle: 'One thread, readiness, non-blocking sockets',
    blurb:
      'A single-threaded loop over epoll or kqueue. The scratch repo starts here — only the files this chapter needs.',
    status: 'ready',
    minors: ['tcp-server'],
  },
  {
    id: 'csp-protocol',
    label: 'CSP',
    subtitle: 'Cinder Serialization Protocol',
    blurb:
      'Typed framing: bulk strings, arrays, integers, errors. Partial reads and leftovers become the codec’s job.',
    status: 'planned',
  },
  {
    id: 'commands',
    label: 'Commands',
    subtitle: 'Dispatch table and a CSP client',
    blurb:
      'Verb → handler registry, arity checks, GET/SET/DEL. A small CLI proves the wire without hand-rolling frames.',
    status: 'planned',
  },
  {
    id: 'keyspace',
    label: 'Keyspace',
    subtitle: 'Dict and lazy TTL',
    blurb:
      'One map of entries with optional deadlines. Expire on access; sampling stays out of V0.1.',
    status: 'planned',
  },
  {
    id: 'append-only-log',
    label: 'Append-only log',
    subtitle: 'Checksummed records and fsync policy',
    blurb:
      'Frame mutations, append before ACK, pick always / everysec / no.',
    status: 'planned',
  },
  {
    id: 'recovery',
    label: 'Recovery',
    subtitle: 'Torn tails and replay',
    blurb:
      'On open: truncate a torn tail, replay complete records, refuse mid-file corruption.',
    status: 'planned',
  },
  {
    id: 'compaction',
    label: 'Compaction',
    subtitle: 'Rewrite live keys',
    blurb:
      'Snapshot the dict, rewrite live SETs via temp + rename — not Truncate(0).',
    status: 'planned',
  },
  {
    id: 'benchmarks',
    label: 'Benchmarks',
    subtitle: 'INFO counters and p99',
    blurb:
      'Measure what you built. Counters, INFO, and a load gen that prints tails not averages.',
    status: 'planned',
  },
];

const EMBER_MODULES: ProjectModule[] = [
  {
    id: 'memtable',
    label: 'Memtable',
    subtitle: 'Buffer writes in a sorted structure',
    blurb:
      'Writes land in a memtable — a skiplist in RAM — so a put is a pointer swing, not a disk seek. When the structure crosses a size threshold it freezes and a new one takes traffic. That freeze is the seam every later module hangs off: the frozen table has to become a file, and the live one has to keep accepting writes while it does.',
    status: 'planned',
  },
  {
    id: 'wal',
    label: 'Write-ahead log',
    subtitle: 'Survive a crash between flushes',
    blurb:
      'A memtable is gone if the process dies. Every mutation is appended to a write-ahead log before it is acknowledged, so a crash between flushes replays into an empty skiplist and the last acknowledged write is still there. You pick an fsync policy and live with what it means when someone pulls the plug.',
    status: 'planned',
  },
  {
    id: 'sstable',
    label: 'SSTables',
    subtitle: 'Immutable sorted runs with a sparse index',
    blurb:
      'The frozen memtable is written as an SSTable: sorted blocks, a sparse index, and a footer. A point lookup binary-searches the index and reads one block. Because the file never mutates, a reader can hold it without a lock, and a compaction can replace it by swapping a pointer.',
    status: 'planned',
  },
  {
    id: 'bloom',
    label: 'Bloom filters',
    subtitle: 'Skip tables that cannot hold the key',
    blurb:
      'A get that misses still has to ask every table that might hold the key. A bloom filter per SSTable answers “definitely not” most of the time, so you skip the disk read. You size the filter for a false-positive rate you can defend, and you measure how many lookups it actually saved.',
    status: 'planned',
  },
  {
    id: 'compaction',
    label: 'Leveled compaction',
    subtitle: 'Merge runs across levels',
    blurb:
      'Flushes pile up. Leveled compaction merges overlapping runs downward so a point lookup touches a bounded number of files. The work is the cost: write amplification, extra disk, and a merge that must not stall the memtable long enough for puts to back up. You pick a level size and watch what the merging costs you.',
    status: 'planned',
  },
  {
    id: 'range-scans',
    label: 'Range scans',
    subtitle: 'Ordered iteration across every level',
    blurb:
      'A scan has to see every live key in order, including the memtable and every level. Merge iterators sit behind one cursor so the caller walks a single sequence. Deleted keys and older versions have to disappear at the merge, not after the client has already seen them.',
    status: 'planned',
  },
];

const QUORUM_MODULES: ProjectModule[] = [
  {
    id: 'replicated-log',
    label: 'Replicated log',
    subtitle: 'The metadata log controllers agree on',
    blurb:
      'Before any node talks to another you model the log: records, offsets, and terms. This is the metadata Kafka controllers agree on — topic assignments, broker membership, partition leaders — written as a sequence, not a mutable map. Everything later is “append here, read from here.”',
    status: 'planned',
  },
  {
    id: 'elections',
    label: 'Leader election',
    subtitle: 'Terms, votes, and exactly one leader',
    blurb:
      'A term, a vote, and a rule that a candidate needs a majority. Elect a controller and keep a stale one from acting like it still leads: a vote granted in a newer term has to fence the old leader, or a split brain writes two histories.',
    status: 'planned',
  },
  {
    id: 'replication',
    label: 'Log replication',
    subtitle: 'Fan records out and commit on quorum',
    blurb:
      'The leader fans entries to followers and tracks who has what. The high watermark — the last committed offset — advances only when a majority has the record. Clients are told “committed” at that watermark, never at the leader’s own append.',
    status: 'planned',
  },
  {
    id: 'partitions',
    label: 'Partition tolerance',
    subtitle: 'Minorities must not commit',
    blurb:
      'Split the cluster. The minority must not commit; the majority keeps going. When the network heals, the loser truncates uncommitted tail and catches up from the leader. Correctness is the test: no acknowledged metadata change is missing, and no phantom one appears.',
    status: 'planned',
  },
  {
    id: 'snapshots',
    label: 'Snapshots',
    subtitle: 'Bound recovery time',
    blurb:
      'A log that grows forever makes restart unbounded. Checkpoint cluster state into a snapshot, truncate the prefix, and install the snapshot on a follower that is too far behind to catch up from entries alone.',
    status: 'planned',
  },
  {
    id: 'metadata-plane',
    label: 'Metadata plane',
    subtitle: 'Serve topic and broker state',
    blurb:
      'Turn the committed log into the cluster state brokers actually read: topics, partitions, ISR, controller identity. Serve that state, apply new committed records, and prove that what a broker sees matches the log, not a cache that drifted.',
    status: 'planned',
  },
];

export const PROJECTS: ProjectEntry[] = [
  {
    id: 'cinder',
    name: 'Cinder',
    subtitle: 'Building a KV store',
    blurb:
      'A single-threaded key–value store in Go. Eight chapters from an empty scratch repo to a durable store you can measure.',
    about: [
      'Cinder is a key–value store you build sitting by sitting. The workspace starts nearly empty: each chapter adds only the files that chapter needs, with TODOs where you work and author-owned wiring (logger, process main, Makefile) filled in as the tree grows.',
      'When V0.1 is done you have CSP on the wire, a dispatch table, a lazy-TTL keyspace, a checksummed append-only log with recovery and compaction, and INFO/bench — something you can kill, restart, and explain. Pub/sub and streams are out of this pass.',
    ],
    level: 'Intermediate',
    language: 'Go',
    facts: ['Event loop', 'Append-only log', '8 chapters'],
    minors: ['tcp-server'],
    status: 'ready',
    modules: CINDER_MODULES,
  },
  {
    id: 'ember',
    name: 'Ember',
    subtitle: 'Building a KV store II — LSM engine',
    blurb:
      'The sequel to Cinder: trade the hash index for an LSM tree. Memtable, write-ahead log, sorted SSTables, bloom filters, and leveled compaction that keeps read amplification in check.',
    about: [
      'Ember is the storage engine Cinder does not have. Cinder keeps the keyspace in memory and durability in an append-only log. Ember trades that hash index for an LSM tree so writes stay sequential on disk and the working set can grow past RAM.',
      'Writes land in a memtable — a skiplist in RAM — so a put is a pointer swing, not a disk seek. When it fills it freezes and a new one takes traffic. Every mutation also hits a write-ahead log before it is acknowledged, so a crash between flushes can replay into an empty skiplist. The frozen table becomes an SSTable: sorted blocks, a sparse index, a footer. A point lookup binary-searches the index and reads one block.',
      'A get that misses still has to ask every table that might hold the key. A bloom filter per SSTable answers “definitely not” most of the time. Flushes pile up; leveled compaction merges overlapping runs downward so a point lookup touches a bounded number of files. A scan sees every live key in order — memtable and every level — behind one cursor, with deleted keys gone at the merge.',
    ],
    level: 'Advanced',
    language: 'Go',
    facts: ['LSM tree', 'SSTables + bloom filters', `${EMBER_MODULES.length} modules`],
    status: 'planned',
    modules: EMBER_MODULES,
  },
  {
    id: 'quorum',
    name: 'Quorum',
    subtitle: 'Implementing KRaft',
    blurb:
      'Kafka metadata without ZooKeeper. Implement the Raft core — leader election, log replication, and snapshots — then drive a controller quorum that agrees on cluster state under partition.',
    about: [
      'Quorum is Kafka’s metadata plane without ZooKeeper: a controller cluster that agrees on topics, partitions, and brokers using Raft. You implement the consensus core first, then hang the metadata API on the committed log.',
      'Before any node talks to another you model the log — records, offsets, and terms. Leader election uses terms and votes so a stale leader cannot keep committing. The leader fans entries to followers; the high watermark moves only when a majority has the record. Split the cluster and a minority must not commit. When the network heals, the loser truncates uncommitted tail and catches up.',
      'A log that grows forever makes restart unbounded, so you checkpoint cluster state into a snapshot and install it on a follower that is too far behind. The last sitting turns the committed log into the cluster state brokers actually read: topics, partitions, ISR, controller identity.',
    ],
    level: 'Advanced',
    language: 'Java',
    facts: ['Raft consensus', 'Controller quorum', `${QUORUM_MODULES.length} modules`],
    status: 'planned',
    modules: QUORUM_MODULES,
  },
];

export function getProject(id: string | null | undefined): ProjectEntry | null {
  if (!id) return null;
  return PROJECTS.find((p) => p.id === id) || null;
}

export function getProjectModule(
  project: ProjectEntry | null | undefined,
  moduleId: string | null | undefined,
): ProjectModule | null {
  if (!project || !moduleId) return null;
  return project.modules.find((m) => m.id === moduleId) || null;
}
