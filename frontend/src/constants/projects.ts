/** Majors — multi-stage builds you carry from an empty repo to a working system. */

export const MAJORS_PATH = '/play/majors';
/** @deprecated Use MAJORS_PATH */
export const PROJECTS_PATH = MAJORS_PATH;

/**
 * A module is one sitting: theory on the left, a full repo on the right with the
 * pieces the candidate has to fill in. `ready` modules have authored content in
 * `fixtures/projectModules`; `planned` ones are the roadmap and render as locked.
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
  modules: ProjectModule[];
}

/**
 * Cinder — a single-threaded, Redis-shaped key–value store in Go.
 *
 * The order matters: the event loop comes first because every later module
 * (protocol, commands, expiry, durability) hangs off the same single-threaded
 * loop. The blocking TCP server is a separate minor, not a module you throw
 * away. Storage arrives only once there is a server to store things for.
 */
const CINDER_MODULES: ProjectModule[] = [
  {
    id: 'event-loop',
    label: 'The event loop',
    subtitle: 'One thread, non-blocking sockets, readiness notification',
    blurb:
      'A single-threaded loop over epoll or kqueue. Non-blocking sockets, a readiness queue, and per-connection buffers — the reason the storage engine below never needs a lock. The blocking TCP server lives in a minor if you want that model in your hands first.',
    status: 'ready',
    minors: ['tcp-server'],
  },
  {
    id: 'resp-protocol',
    label: 'Speaking RESP',
    subtitle: 'Parse and serialize the Redis wire protocol',
    blurb:
      'Swap the toy line protocol for RESP: bulk strings, arrays, integers, and errors. Handle partial frames, because a socket read gives you whatever arrived, not whatever you wanted.',
    status: 'planned',
  },
  {
    id: 'commands',
    label: 'The command layer',
    subtitle: 'GET, SET, DEL, and a dispatch table',
    blurb:
      'Route parsed commands to handlers, validate arity and types, and return errors the way a real client expects. The first module where redis-cli can talk to your server.',
    status: 'planned',
  },
  {
    id: 'keyspace',
    label: 'Keyspace and expiry',
    subtitle: 'TTLs, lazy expiry, and an active sampling cycle',
    blurb:
      'Attach deadlines to keys, expire them lazily on access, and add the background sampling pass that keeps dead keys from pinning memory forever.',
    status: 'planned',
  },
  {
    id: 'pubsub',
    label: 'Pub/Sub',
    subtitle: 'Fan-out delivery and the slow-subscriber problem',
    blurb:
      'The first commands where the server speaks first. SUBSCRIBE puts a connection into a different mode, PUBLISH fans one message to every listener, and a subscriber that stops reading forces you to decide who you are willing to drop.',
    status: 'planned',
  },
  {
    id: 'streams',
    label: 'Streams',
    subtitle: 'A log with entry IDs, blocking reads, and consumer groups',
    blurb:
      'Pub/Sub forgets a message the moment nobody is listening; a stream remembers it. Monotonic entry IDs, range queries, blocking XREAD that parks a client without parking the loop, and consumer groups that track what each reader acknowledged.',
    status: 'planned',
  },
  {
    id: 'append-only-log',
    label: 'The append-only log',
    subtitle: 'Durability by writing every mutation down first',
    blurb:
      'Frame each mutation with a checksum, append it to a segment, and decide what fsync policy you are willing to defend when someone pulls the plug.',
    status: 'planned',
  },
  {
    id: 'recovery',
    label: 'Crash recovery',
    subtitle: 'Rebuild the keyspace from segments on boot',
    blurb:
      'Replay segments into memory, detect the torn record at the tail, and prove that an acknowledged write survives a hard kill.',
    status: 'planned',
  },
  {
    id: 'compaction',
    label: 'Segment compaction',
    subtitle: 'Reclaim space from overwritten and deleted keys',
    blurb:
      'Roll segments, merge live keys forward, and swap the index atomically — all without stalling the loop long enough for clients to notice.',
    status: 'planned',
  },
  {
    id: 'benchmarks',
    label: 'Benchmarks and observability',
    subtitle: 'Measure throughput and tail latency, then explain it',
    blurb:
      'Drive the server with a load generator, read p99 instead of averages, and add the INFO counters you need to argue about where the time goes.',
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
      'A single-threaded, Redis-shaped key–value store in Go. You start at the event loop — one thread, non-blocking sockets — and end with a durable append-only store you can benchmark and explain.',
    about: [
      'Cinder is a Redis-shaped key–value store written in Go. You build the whole server, not a library: speak a wire protocol, keep a keyspace, and survive a crash with an append-only log you can replay. When you are done you have something redis-cli can talk to, that you can kill and restart, compact, and measure.',
      'You start at the event loop, not at accept(). A blocking TCP server — one goroutine per connection — is a separate minor if that model is not already in your hands. Here you replace it with a single-threaded loop over epoll or kqueue: non-blocking sockets, a readiness queue, and per-connection buffers. From here on the rest of the server never takes a lock, because there is only one thread that mutates anything.',
      'The toy line protocol comes out and RESP comes in — bulk strings, arrays, integers, and errors. A socket read gives you whatever arrived, not a complete frame, so the codec has to reassemble across reads. Parsed commands hit a dispatch table: GET, SET, DEL, arity checks, and errors the way a real client expects. That is the first point redis-cli can talk to your server.',
      'Keys grow deadlines. Expire them lazily on access so a GET of a dead key looks like a miss, then add the sampling pass that walks random keys in the background so expired entries do not pin memory forever. Pub/sub is the first time the server speaks first: SUBSCRIBE puts a connection into a different mode, PUBLISH fans one message to every listener, and a subscriber that stops reading forces you to decide who you are willing to drop. Streams remember what pub/sub forgets — monotonic entry IDs, range queries, blocking XREAD that parks a client without parking the loop, and consumer groups that track what each reader acknowledged.',
      'Durability arrives last because there has to be a server worth keeping. Frame each mutation with a checksum, append it to a segment, and pick an fsync policy you can defend when someone pulls the plug. Boot replays those segments into memory, detects the torn record at the tail, and proves an acknowledged write survives a hard kill. Compaction rolls segments, merges live keys forward, and swaps the index without stalling the loop long enough for clients to notice. The last sitting is measurement: drive the server with a load generator, read p99 instead of averages, and add the INFO counters you need to argue about where the time goes.',
    ],
    level: 'Intermediate',
    language: 'Go',
    facts: ['Event loop', 'Append-only log', `${CINDER_MODULES.length} modules`],
    minors: ['tcp-server'],
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
