'use strict';

/**
 * Paper of the Month pool. Answers live here only; the API sends questions
 * without `answer` until the caller has submitted their one attempt.
 */

interface PaperQuestion {
  prompt: string;
  choices: string[];
  /** Index into `choices`. */
  answer: number;
  explanation: string;
}

interface MonthlyPaper {
  id: string;
  title: string;
  shortTitle: string;
  authors: string;
  venue: string;
  year: number;
  blurb: string;
  href: string;
  questions: PaperQuestion[];
}

const TOKENS_PER_PAPER = 20;
const DEFAULT_PAPER_ID = 'gfs';

const MONTHLY_PAPERS: MonthlyPaper[] = [
  {
    id: 'gfs',
    title: 'The Google File System',
    shortTitle: 'GFS',
    authors: 'Sanjay Ghemawat, Howard Gobioff, Shun-Tak Leung',
    venue: 'SOSP',
    year: 2003,
    blurb:
      'A distributed file system built for huge files, streaming reads, and appends on commodity machines that fail all the time — one master for metadata, many chunkservers for data.',
    href: '/api/papers/monthly/gfs',
    questions: [
      {
        prompt: 'What is the default chunk size in GFS?',
        choices: ['4 KB', '1 MB', '64 MB', '1 GB'],
        answer: 2,
        explanation:
          'Chunks are 64 MB. Large chunks keep master metadata small and let clients reuse one TCP connection for long sequential reads.',
      },
      {
        prompt: 'What does the single GFS master keep?',
        choices: [
          'A full copy of every chunk, as the source of truth',
          'Only metadata: the namespace, the file-to-chunk mapping, and where chunks live',
          'Nothing — clients find chunks by gossiping with chunkservers',
          'The file data for small files, while big files go to chunkservers',
        ],
        answer: 1,
        explanation:
          'The master holds only metadata. File data never flows through it; clients ask it where chunks are and then talk to chunkservers directly.',
      },
      {
        prompt: 'By default, how many replicas does GFS keep of each chunk?',
        choices: ['1', '2', '3', '5'],
        answer: 2,
        explanation: 'Three replicas by default, spread across racks so a rack failure does not lose a chunk.',
      },
      {
        prompt: 'How does GFS order concurrent writes to the same chunk across its replicas?',
        choices: [
          'The master serializes every write itself',
          'The master grants a lease to one replica, the primary, which picks a serial order the others follow',
          'Clients attach vector clocks and replicas merge on read',
          'Each write runs its own Paxos round among the replicas',
        ],
        answer: 1,
        explanation:
          'A chunk lease makes one replica the primary. It assigns serial numbers to mutations and every secondary applies them in that order, keeping the master off the write path.',
      },
      {
        prompt: 'What does record append guarantee?',
        choices: [
          'The record is written exactly once, at the offset the client chose',
          'The record is written atomically at least once, at an offset GFS chooses — duplicates are possible',
          'The record is written at most once and may be silently dropped',
          'The record is written only if the client holds a file lock',
        ],
        answer: 1,
        explanation:
          'Record append is at-least-once and atomic. Retries after a failure can leave duplicates or padding, so applications use checksums and unique IDs to skip them.',
      },
    ],
  },
  {
    id: 'mapreduce',
    title: 'MapReduce: Simplified Data Processing on Large Clusters',
    shortTitle: 'MapReduce',
    authors: 'Jeffrey Dean, Sanjay Ghemawat',
    venue: 'OSDI',
    year: 2004,
    blurb:
      'Write a map and a reduce function; the library handles partitioning, scheduling, shuffling, and machine failures across thousands of nodes.',
    href: '/api/papers/monthly/mapreduce',
    questions: [
      {
        prompt: 'Why are completed map tasks re-run when their worker fails?',
        choices: [
          'Their output sits on the failed machine’s local disk and is now unreachable',
          'The master re-runs every task twice to double-check results',
          'Map output is stored in GFS but marked corrupt after a failure',
          'They are not — only in-progress tasks are re-run',
        ],
        answer: 0,
        explanation:
          'Map output is written to the worker’s local disk. When the worker dies, that output is gone, so the map tasks must run again. Completed reduce output is already in the global file system.',
      },
      {
        prompt: 'How does MapReduce deal with stragglers near the end of a job?',
        choices: [
          'It kills the job and restarts it on faster machines',
          'It schedules backup copies of the remaining in-progress tasks and takes whichever finishes first',
          'It waits — correctness matters more than latency',
          'It lowers the number of reduce partitions on the fly',
        ],
        answer: 1,
        explanation:
          'Near the end, the master launches backup executions of in-progress tasks. Whichever copy finishes first wins, which cuts the long tail significantly.',
      },
      {
        prompt: 'What is the combiner function for?',
        choices: [
          'Joining two input datasets before the map phase',
          'Partially merging map output on the map worker to cut network traffic',
          'Combining the final reduce outputs into a single file',
          'Merging duplicate workers that picked up the same task',
        ],
        answer: 1,
        explanation:
          'A combiner does a local, partial reduce on each map worker — for word count, summing counts per word — so far less data crosses the network in the shuffle.',
      },
      {
        prompt: 'How are intermediate keys assigned to reduce tasks by default?',
        choices: [
          'Round-robin in the order keys are produced',
          'hash(key) mod R, where R is the number of reduce tasks',
          'Sorted ranges chosen by sampling the input',
          'Whichever reduce worker is least loaded',
        ],
        answer: 1,
        explanation: 'The default partitioner is hash(key) mod R. Users can supply their own, for example to group URLs by host.',
      },
      {
        prompt: 'How does the master save network bandwidth when scheduling map tasks?',
        choices: [
          'It compresses all input before the job starts',
          'It schedules map tasks on or near machines that already hold a replica of the input',
          'It runs every map task on the master itself',
          'It streams input through a central cache',
        ],
        answer: 1,
        explanation:
          'Input lives in GFS with replicas on the cluster’s machines. The master prefers to run each map task where a replica already is, so most input is read locally.',
      },
    ],
  },
  {
    id: 'dynamo',
    title: 'Dynamo: Amazon’s Highly Available Key-value Store',
    shortTitle: 'Dynamo',
    authors: 'Giuseppe DeCandia et al.',
    venue: 'SOSP',
    year: 2007,
    blurb:
      'An always-writeable key-value store that trades strong consistency for availability, using consistent hashing, vector clocks, sloppy quorums, and anti-entropy.',
    href: '/api/papers/monthly/dynamo',
    questions: [
      {
        prompt: 'How does Dynamo partition keys across nodes?',
        choices: [
          'Range partitioning managed by a central master',
          'Consistent hashing, with each node owning several virtual nodes on the ring',
          'Static modulo hashing over a fixed node count',
          'Random placement with a global lookup table',
        ],
        answer: 1,
        explanation:
          'Keys hash onto a ring. Virtual nodes spread each physical node’s load and make adding or removing nodes move only a small slice of keys.',
      },
      {
        prompt: 'How does Dynamo detect conflicting versions of an object?',
        choices: ['Wall-clock timestamps', 'Vector clocks', 'A global sequence number', 'Checksums of the value'],
        answer: 1,
        explanation:
          'Each version carries a vector clock. If neither clock descends from the other, the versions conflict and are returned to the client to reconcile.',
      },
      {
        prompt: 'What does choosing R + W > N give you?',
        choices: [
          'Linearizable transactions',
          'Read and write sets that overlap, as in a quorum system',
          'Writes that never fail',
          'Zero replication lag',
        ],
        answer: 1,
        explanation:
          'With R + W > N, a read quorum overlaps the latest write quorum. Dynamo’s quorums are sloppy, though, so this is a tuning knob rather than a strict guarantee.',
      },
      {
        prompt: 'How does Dynamo keep accepting writes when a replica is temporarily down?',
        choices: [
          'It blocks writes until the replica returns',
          'Hinted handoff: another node accepts the write and hands it back later',
          'It writes only to the coordinator',
          'It drops the replica permanently and re-replicates everything',
        ],
        answer: 1,
        explanation:
          'A healthy node takes the write with a hint naming the intended owner, and delivers it once that node recovers.',
      },
      {
        prompt: 'How do replicas find and repair divergence after longer failures?',
        choices: [
          'Full data dumps compared nightly',
          'Merkle trees exchanged during anti-entropy',
          'A master that tracks every write',
          'Clients repair data on every read only',
        ],
        answer: 1,
        explanation:
          'Each node keeps a Merkle tree per key range. Comparing tree roots and descending only into differing branches finds out-of-sync keys with little data transfer.',
      },
    ],
  },
  {
    id: 'raft',
    title: 'In Search of an Understandable Consensus Algorithm',
    shortTitle: 'Raft',
    authors: 'Diego Ongaro, John Ousterhout',
    venue: 'USENIX ATC',
    year: 2014,
    blurb:
      'A consensus algorithm designed to be understood: a strong leader, randomized elections, and a replicated log that a majority must accept before it counts.',
    href: '/api/papers/monthly/raft',
    questions: [
      {
        prompt: 'What was Raft’s primary design goal?',
        choices: ['Maximum throughput', 'Understandability', 'Byzantine fault tolerance', 'Leaderless operation'],
        answer: 1,
        explanation:
          'The authors set out to make consensus easier to understand than Paxos, decomposing it into leader election, log replication, and safety.',
      },
      {
        prompt: 'When does a follower start an election?',
        choices: [
          'Every fixed number of seconds',
          'When its election timeout passes without hearing from a leader',
          'When a client asks it to',
          'When its log is longer than the leader’s',
        ],
        answer: 1,
        explanation: 'If a follower hears no heartbeat before its election timeout, it becomes a candidate, bumps the term, and asks for votes.',
      },
      {
        prompt: 'Why are election timeouts randomized?',
        choices: [
          'To spread CPU load',
          'To make split votes unlikely, so one candidate usually wins quickly',
          'To hide the leader from attackers',
          'To keep clocks in sync',
        ],
        answer: 1,
        explanation:
          'Random timeouts mean one server usually times out first and wins before others start competing, so split votes are rare.',
      },
      {
        prompt: 'When is a log entry from the current term committed?',
        choices: [
          'As soon as the leader writes it locally',
          'Once the leader has replicated it on a majority of servers',
          'Once every server has it',
          'When the client acknowledges it',
        ],
        answer: 1,
        explanation: 'A current-term entry is committed once a majority stores it; then it is safe to apply to the state machine.',
      },
      {
        prompt: 'Which voters will grant a vote to a candidate?',
        choices: [
          'Any voter that has not voted yet this term',
          'Only voters whose own log is not more up-to-date than the candidate’s',
          'Only the previous leader',
          'Voters in the same data center',
        ],
        answer: 1,
        explanation:
          'The election restriction: a voter refuses a candidate whose log is less up-to-date than its own, so a new leader always has every committed entry.',
      },
    ],
  },
  {
    id: 'bigtable',
    title: 'Bigtable: A Distributed Storage System for Structured Data',
    shortTitle: 'Bigtable',
    authors: 'Fay Chang et al.',
    venue: 'OSDI',
    year: 2006,
    blurb:
      'A sparse, sorted, multi-dimensional map split into tablets, served by tablet servers, coordinated through Chubby, and stored as SSTables on GFS.',
    href: '/api/papers/monthly/bigtable',
    questions: [
      {
        prompt: 'How does the paper describe Bigtable’s data model?',
        choices: [
          'A relational database with SQL joins',
          'A sparse, distributed, persistent multi-dimensional sorted map indexed by row, column, and timestamp',
          'A document store keyed by JSON paths',
          'An append-only log of events',
        ],
        answer: 1,
        explanation: 'Each value is addressed by (row key, column key, timestamp), and rows are kept in sorted order.',
      },
      {
        prompt: 'What unit are row ranges split into for distribution and load balancing?',
        choices: ['Chunks', 'Tablets', 'Shards', 'Regions'],
        answer: 1,
        explanation: 'A table is split by row range into tablets, and each tablet is served by one tablet server at a time.',
      },
      {
        prompt: 'What does Bigtable use Chubby for?',
        choices: [
          'Storing all table data',
          'Ensuring a single active master, bootstrapping tablet locations, and tracking live tablet servers',
          'Compressing SSTables',
          'Running client queries',
        ],
        answer: 1,
        explanation:
          'Chubby, a lock service, guarantees one master, stores where the root tablet is, and lets the master see which tablet servers are alive.',
      },
      {
        prompt: 'What is the on-disk file format Bigtable stores data in?',
        choices: ['B-tree pages', 'SSTables — immutable, sorted key-value files', 'CSV files', 'Parquet'],
        answer: 1,
        explanation: 'Data lives in SSTables on GFS: immutable, sorted maps from keys to values, with an index for fast lookup.',
      },
      {
        prompt: 'Where does a write go first on a tablet server?',
        choices: [
          'Straight into an SSTable',
          'To a commit log, then into the in-memory memtable',
          'Only into memory, with no log',
          'To the master, which forwards it',
        ],
        answer: 1,
        explanation:
          'Writes are logged for durability and applied to the memtable. Full memtables are flushed into new SSTables (a minor compaction).',
      },
    ],
  },
];

function getMonthlyPaper(id: string | null | undefined): MonthlyPaper | null {
  if (!id) return null;
  return MONTHLY_PAPERS.find((p) => p.id === id) || null;
}

function tokensFor(correct: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((TOKENS_PER_PAPER * correct) / total);
}

module.exports = { MONTHLY_PAPERS, TOKENS_PER_PAPER, DEFAULT_PAPER_ID, getMonthlyPaper, tokensFor };
