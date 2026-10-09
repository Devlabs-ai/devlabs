import type { ChapterReading } from './types';

/** LSM tree minor, chapter 00: what an LSM tree is, where it runs, and the plan. */
export const LSM_TREE_OVERVIEW: ChapterReading = {
  eyebrow: 'LSM tree · Chapter 00',
  title: 'LSM trees: the engine behind write-heavy databases',
  lede:
    'Start here before writing any code. We explain **what a log-structured merge tree is**, why so many databases are built on one, the operational problems it causes in production, and exactly what you will build across the five chapters of this minor.',
  showBlogStamp: true,
  sections: [
    {
      id: 'what-is-an-lsm-tree',
      title: 'What is an LSM tree?',
      body: [
        'A **log-structured merge tree** (LSM tree) is a way to store key/value data on disk built around one rule: **never update a file in place**. New writes are buffered in memory, written out as sorted files that are never modified again, and those files are merged together in the background.',
        'That sounds like a small implementation detail. It is actually a different answer to the most basic question a database has to answer: *what happens when I change a key?*',
      ],
      subsections: [
        {
          id: 'the-problem',
          title: 'The problem it solves',
          body: [
            'Disks, both SSDs and spinning drives, handle **sequential** writes far better than **random** ones. A spinning disk pays a physical seek of several milliseconds for every random write. An SSD cannot overwrite a page directly; it erases and rewrites whole blocks, so scattered small writes cause extra internal copying and wear.',
            'So the cheapest possible write is "append to the end of a file". The expensive one is "go find the right spot somewhere on disk and change it".',
          ],
        },
        {
          id: 'two-ways',
          title: 'Two ways to change a key',
          body: [
            'The classic on-disk structure, the **B-tree**, keeps data in fixed-size pages and updates them **in place**. Change one key and the database finds the page that holds it and rewrites that page. Postgres, MySQL’s InnoDB, and SQLite all work this way. A stream of writes to random keys becomes a stream of random page writes.',
            'An **LSM tree** turns that around. Writes collect in a sorted buffer in memory. When the buffer is full, it is written to disk in one sequential pass as a sorted file. Nothing already on disk is touched.',
          ],
        },
      ],
      table: {
        headers: ['', 'B-tree', 'LSM tree'],
        rows: [
          ['**A write does**', 'Find the page, rewrite it in place', 'Append to a log and a memory buffer'],
          ['**Disk pattern**', 'Random writes', 'Sequential writes'],
          ['**Where a key lives**', 'Exactly one place', 'Possibly several: memory plus several files'],
          ['**Cleanup**', 'None needed', 'Background merging (compaction)'],
        ],
      },
      callout: {
        kind: 'idea',
        title: 'The trade an LSM tree makes',
        body: [
          'Writes become cheap and sequential. The price is that one key can exist in several places at once, so **reads have to check more than one place**, and a background process, **compaction**, has to keep merging files so old versions do not pile up forever.',
        ],
      },
    },
    {
      id: 'how-it-works',
      title: 'How the pieces fit together',
      body: [
        'An LSM tree has a write path, a read path, and background work. Each box below is one chapter of this minor.',
      ],
      flows: [
        {
          title: 'Write path',
          steps: ['`Put` / `Delete`', 'Append to the **write-ahead log**', 'Insert into the **memtable**', 'Memtable full → **flush** to an SSTable'],
        },
        {
          title: 'Read path',
          steps: ['`Get`', '**Memtable**', 'Newest **SSTable**', 'Older SSTables', 'First answer wins'],
        },
        {
          title: 'Background',
          steps: ['Many small SSTables', '**Compaction** merges them', 'Fewer, larger SSTables, dead data gone'],
        },
      ],
      after: [
        '**Write-ahead log (WAL).** Every write is first appended to a log file, so a crash cannot lose it. On startup the log is replayed.',
        '**Memtable.** The write then goes into a sorted structure in memory. Reads check it first.',
        '**Flush.** A full memtable is written to disk as an **SSTable** (Sorted String Table): key/value pairs in key order, never modified after they are written.',
        '**Read path.** A lookup checks the memtable, then SSTables from newest to oldest. Newer data shadows older data, so the first answer found wins. **Bloom filters** let it skip files that cannot hold the key.',
        '**Compaction.** SSTables are merged into fewer, larger ones, keeping only the newest version of each key and dropping deleted data.',
      ],
      callout: {
        kind: 'tip',
        title: 'Deletes are writes too',
        body: [
          'An LSM tree cannot remove a key from a file it never modifies. So a delete writes a **tombstone**, a marker that says "this key is gone". The tombstone shadows the older value on every read until compaction removes both.',
        ],
      },
    },
    {
      id: 'where-its-used',
      title: 'Where LSM trees run',
      body: [
        'The idea comes from a 1996 paper by Patrick O’Neil and colleagues. Google’s **Bigtable** paper (2006) made it mainstream and gave us the words *memtable* and *SSTable*. Today it sits underneath many of the systems you will run in production:',
      ],
      table: {
        headers: ['System', 'What it is', 'How the LSM tree shows up'],
        rows: [
          ['**LevelDB**', 'Google’s embedded key/value library', 'The reference LSM implementation. Bitcoin Core keeps its chain state in it.'],
          ['**RocksDB**', 'Meta’s fork of LevelDB', 'Embedded in MyRocks (a MySQL storage engine), Kafka Streams state stores, Apache Flink’s state backend, and TiKV.'],
          ['**Apache Cassandra**', 'Distributed wide-column database', 'Every node writes a commit log, a memtable, and SSTables, and runs compaction.'],
          ['**ScyllaDB**', 'Cassandra-compatible database in C++', 'The same model, rewritten for speed.'],
          ['**HBase**, **Google Bigtable**', 'Wide-column stores on distributed file systems', 'The original memtable + SSTable design.'],
          ['**Pebble**', 'CockroachDB’s storage engine, in Go', 'Replaced RocksDB inside CockroachDB.'],
          ['**Badger**', 'Key/value store in Go, used by Dgraph', 'An LSM tree that keeps large values in a separate log.'],
        ],
      },
      after: [
        'The same "write immutable sorted pieces, merge them later" idea shows up beyond key/value stores too: **Lucene** and **Elasticsearch** merge immutable index segments, and **ClickHouse**’s MergeTree merges sorted data parts in the background.',
      ],
    },
    {
      id: 'when-to-use',
      title: 'When it is the right choice, and when it is not',
      body: [
        'Neither design wins everywhere. They make opposite trades, which is why both are everywhere.',
      ],
      table: {
        headers: ['LSM trees shine at', 'B-trees are usually better at'],
        rows: [
          ['Write-heavy workloads: logs, metrics, events, messages', 'Read-heavy workloads with many point lookups'],
          ['Ingesting data faster than random I/O allows', 'Predictable read latency on every query'],
          ['Compact storage, since files are rewritten and compressed', 'Frequent in-place updates of the same rows'],
        ],
      },
    },
    {
      id: 'why-it-matters',
      title: 'Why this matters if you run these systems',
      body: [
        'You do not have to write a database to need this. Many of the classic operational problems with Cassandra, RocksDB, or Kafka Streams are LSM behaviour showing through:',
      ],
      bullets: [
        '**Compaction falling behind.** Writes create files faster than compaction can merge them, so every read checks more and more files and latency climbs.',
        '**Disk spikes during compaction.** Merging writes the new files before the old ones are deleted. Some compaction strategies need a lot of free disk to finish.',
        '**Tombstone build-up.** Deleting many keys creates many tombstones, and reads that scan across them slow down. Cassandra warns about, and can fail, queries that cross too many.',
        '**Write amplification.** The same data is rewritten several times as it moves through compaction, so disk I/O and SSD wear run far above what the application actually writes.',
      ],
      after: [
        'After this minor these stop being mysterious tuning knobs. You will have written each mechanism that causes them.',
      ],
    },
    {
      id: 'vocabulary',
      title: 'The words you will use',
      body: ['Every chapter uses these terms. Come back here whenever one is fuzzy.'],
      table: {
        headers: ['Term', 'Meaning'],
        rows: [
          ['**Memtable**', 'Sorted in-memory buffer every write lands in first'],
          ['**Write-ahead log (WAL)**', 'Append-only file of every write, replayed after a crash to rebuild the memtable'],
          ['**SSTable**', 'Sorted String Table: an immutable on-disk file of key/value pairs in key order'],
          ['**Flush**', 'Writing a full memtable out as a new SSTable'],
          ['**Tombstone**', 'A marker recording that a key was deleted'],
          ['**Bloom filter**', 'A small summary that can say "this key is definitely not in this file" without reading the file'],
          ['**Compaction**', 'Merging SSTables into new ones, keeping only the newest version of each key'],
          ['**Write / read / space amplification**', 'How much extra disk writing, file checking, and storage the design costs compared with the data itself'],
        ],
      },
    },
    {
      id: 'what-you-build',
      title: 'What you will build in this minor',
      body: [
        'Over five chapters you build **lsmkv**, a working LSM storage engine in Go, starting from an almost empty repository. Each chapter adds one box from the diagrams above, and each ends with tests that prove it works.',
      ],
      table: {
        headers: ['Chapter', 'You build', 'Done when'],
        rows: [
          ['**01 · Memtable**', 'A skiplist that keeps keys sorted, tombstones for deletes, ordered iteration', 'Random puts and deletes match a reference map, and a lookup takes a few dozen comparisons, not thousands'],
          ['**02 · Write-ahead log**', 'Checksummed log records, append before acknowledging, replay on startup', 'Kill the process mid-write, restart, and nothing that was acknowledged is lost'],
          ['**03 · SSTable**', 'The on-disk file format: data blocks, an index, a footer', '100,000 keys on disk, and any lookup reads one block instead of the whole file'],
          ['**04 · Read path**', 'Bloom filters, newest-first search across files, range scans', 'Lookups for missing keys skip almost every file, and deleted keys stay deleted'],
          ['**05 · Compaction**', 'Merging files, dropping dead data, swapping files safely', 'File count and disk use go down, and every key still reads correctly'],
        ],
      },
    },
    {
      id: 'how-chapters-work',
      title: 'How each chapter works',
      body: [],
      bullets: [
        '**Theory on the left, code on the right.** Each chapter opens with a short read, then sends you into the repository with clearly marked `TODO` blocks.',
        '**Small tasks.** A chapter has two to four tasks, and each turns green as you finish it, so progress shows up long before the chapter is done.',
        '**Tests decide.** When `make test` passes, the chapter is complete.',
        '**The repo grows.** Each chapter adds only the files it needs, on top of your work from the chapter before.',
      ],
      after: [
        '**What you need:** comfortable Go (slices, maps, structs, methods, and `go test`). No database or storage background; every idea is introduced when it is needed.',
      ],
      callout: {
        kind: 'scope',
        title: 'Deliberately left out',
        body: [
          'Production engines also have lock-free concurrent memtables, sequence numbers for snapshots, block compression, and transactions. They are worth knowing about, but each would double the size of a chapter. This minor builds the core all of them sit on.',
        ],
      },
    },
  ],
  takeaways: [
    'An LSM tree never updates a file in place: it buffers writes in memory, writes sorted immutable files, and merges them later.',
    'That makes writes cheap and sequential, at the cost of reads checking several places and background compaction work.',
    'A delete is a write: a tombstone shadows older values until compaction removes both.',
    'RocksDB, LevelDB, Cassandra, ScyllaDB, HBase, and CockroachDB’s Pebble are all built this way, and their classic production problems are LSM behaviour.',
    'Across five chapters you build each piece in Go: memtable, write-ahead log, SSTable, read path, and compaction.',
  ],
};
