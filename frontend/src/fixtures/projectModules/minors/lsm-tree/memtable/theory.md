## Where you are
<!-- mode: read-only -->

Chapter 00 laid out the machine: writes go to a log and a sorted in-memory buffer, full buffers are flushed to sorted files, reads check memory then files newest first, and compaction merges files in the background.

```plaintext
            Put / Delete                         Get
                 │                                │
        ┌────────▼────────┐                       │
  ch 2  │  Write-ahead log │                       │
        └────────┬────────┘                       │
        ┌────────▼────────┐                       │
  ch 1  │    Memtable      │ ◀──── you are here    │
        └────────┬────────┘                       │
                 │ full → flush                   │
        ┌────────▼────────┐                       │
  ch 3  │ SSTable SSTable  │ ◀─────────────────────┘
        └────────┬────────┘   ch 4: the read path
  ch 5           │ compaction
                 ▼
```

This chapter builds the box every write touches first: the **memtable**.

> [!scope] This chapter's job
> Only the memtable. No disk, no files. When you finish, you have a sorted map that
> supports puts, deletes, lookups, and ordered scans, and you know why each of those
> exists for the chapters that follow.

## What the memtable must do
<!-- mode: read-only -->

### Four requirements

Every write goes into the memtable first. Chapter 3 will take a full memtable and write it to disk as a **sorted** file. That gives four requirements:

1. **Fast inserts and overwrites.** Every single write pays this cost.
2. **Fast point lookups.** Reads check the memtable before any file.
3. **Ordered iteration.** Flushing writes keys in sorted order; range scans need it too.
4. **Size tracking.** Something has to decide when the memtable is "full".

### Why not the obvious structures

| Structure | Insert | Lookup | Ordered walk | Problem |
| --- | --- | --- | --- | --- |
| Go `map` | O(1) | O(1) | No | Unordered; you would sort on every flush and every scan |
| Sorted slice | O(n) | O(log n) | Yes | Every insert shifts half the slice |
| Balanced tree (red-black, AVL) | O(log n) | O(log n) | Yes | Works, but rotations make it fiddly to write and hard to read concurrently |
| **Skiplist** | O(log n) expected | O(log n) expected | Yes | Simple, and readers never see half-done rebalancing |

LevelDB and RocksDB both use a skiplist for their memtable, and so will you.

> [!tip] What "expected" means here
> A skiplist uses coin flips to decide its shape. It is not guaranteed to be balanced,
> but the chance of it being badly unbalanced is vanishingly small. With 100,000 keys
> your tests will see roughly 30 comparisons per lookup, not 50,000.

## How a skiplist works
<!-- mode: read-and-implement tasks:1.1,1.2 -->

### A sorted linked list with express lanes

Start with a sorted linked list. Lookups are slow because you must walk node by node. Now add a second list on top that links only every fourth node or so, and a third that links every sixteenth. To search, ride the top lane as far as you can without overshooting, drop down a lane, and repeat.

```plaintext
 level 3  head ─────────────────────────────▶ 41 ─────────────────────────▶ nil
 level 2  head ──────────▶ 12 ──────────────▶ 41 ──────────▶ 67 ──────────▶ nil
 level 1  head ──▶ 5 ────▶ 12 ──▶ 20 ───────▶ 41 ──▶ 50 ───▶ 67 ──▶ 80 ───▶ nil
 level 0  head ─▶ 5 ─▶ 9 ─▶ 12 ─▶ 20 ─▶ 33 ─▶ 41 ─▶ 50 ─▶ 59 ─▶ 67 ─▶ 80 ─▶ nil
```

Each node has a **tower**: a `next` pointer for every level it belongs to. Level 0 contains every node, in order. Higher levels are shortcuts.

### Search: walk right, drop down

To find 59 in the picture above:

```plaintext
 level 3: head → 41 (41 < 59, move right) → nil next   → drop down at 41
 level 2: 41 → 67? 67 ≥ 59, stop                        → drop down at 41
 level 1: 41 → 50 (50 < 59, move right) → 67 ≥ 59, stop → drop down at 50
 level 0: 50 → 59? 59 ≥ 59, stop
 answer: the node after 50 on level 0 → 59
```

The node where you stop on each level is the **last node smaller than the target** on that level. Record it: that list (`prev`) is exactly where a new node would have to be linked in. One walk gives you both the lookup answer and the insertion points.

> [!warn] Do not restart from the head
> When you drop a level, keep going from the node you are on. Restarting from `head` on
> each level turns the search back into a linear scan, and the "search is logarithmic"
> test will catch it.

<!-- lang: go -->
### `TODO(1.1)` — `findGreaterOrEqual`

In `internal/memtable/skiplist.go`. Start at `s.head` on level `s.height - 1`. On each level, move right while the next node's key is smaller than the target (use `s.compare`, which the tests count). Record `prev[level]` if `prev` is non-nil, then drop down. Return `x.next[0]`: the first node whose key is `>=` the target, or `nil`.
<!-- /lang -->
<!-- lang: python -->
### `TODO(1.1)` — `find_greater_or_equal`

In `lsmkv/memtable/skiplist.py`. Start at `self.head` on level `self.height - 1`. On each level, move right while the next node's key is smaller than the target (use `self._less`, which the tests count). Record `prev[level]` if `prev` was passed, then drop down. Return `x.next[0]`: the first node whose key is `>=` the target, or `None`.
<!-- /lang -->
<!-- lang: cpp -->
### `TODO(1.1)` — `FindGreaterOrEqual`

In `src/memtable/skiplist.cc`. Start at `head_` on level `height_ - 1`. On each level, move right while the next node's key is smaller than the target (use `Compare`, which the tests count). Record `prev[level]` if `prev` is not `nullptr`, then drop down. Return `x->next[0]`: the first node whose key is `>=` the target, or `nullptr`.
<!-- /lang -->

### Insert: coin flips decide the tower

A new node's height is random: height 1 with probability 3/4, height 2 with 3/16, and so on (the random-height helper is given). So about one node in four appears on level 1, one in sixteen on level 2. No rebalancing ever happens; the randomness keeps the lanes evenly spaced on average.

```plaintext
 insert 45 with height 2. prev = [41, 41, 41, 41] from the search

 level 1  ... 41 ──────────────▶ 50 ...      ... 41 ──▶ 45 ──▶ 50 ...
 level 0  ... 41 ──▶ 50 ...           →      ... 41 ──▶ 45 ──▶ 50 ...
```

For each level `i` the new node reaches, splice it in after `prev[i]`: point the new node's level-`i` link at `prev[i]`'s old successor, then point `prev[i]`'s level-`i` link at the new node. If the new tower is taller than anything in the list so far, its predecessor on those new levels is `head`.

> [!idea] Overwrite in place
> If the key is already there, do not insert a second node. Replace the value and kind
> on the existing node. A memtable holds **one entry per key**: the newest write. Older
> versions of the key may exist on disk, and chapter 4 makes sure the memtable wins.

<!-- lang: go -->
### `TODO(1.2)` — `put`

1. Search with a `prev` array.
2. Same key found: overwrite value and kind, adjust `s.size` by the change in value length, return. `s.length` does not change.
3. New key: pick a height, raise `s.height` (with `head` as predecessor) if needed, splice the tower into every level it reaches: `n.next[i] = prev[i].next[i]`, then `prev[i].next[i] = n`.
4. `s.length++`, `s.size += entrySize(key, value)`.
<!-- /lang -->
<!-- lang: python -->
### `TODO(1.2)` — `put`

1. Search with `prev = [None] * MAX_HEIGHT`.
2. Same key found: overwrite value and kind, adjust `self.size` by the change in value length (a tombstone's value is `None`, length 0), return. `self.length` does not change.
3. New key: pick a height, raise `self.height` (with `self.head` as predecessor) if needed, splice the tower into every level it reaches: `n.next[i] = prev[i].next[i]`, then `prev[i].next[i] = n`.
4. `self.length += 1`, `self.size += entry_size(key, value)`.
<!-- /lang -->
<!-- lang: cpp -->
### `TODO(1.2)` — `Put`

1. Search with `Node* prev[kMaxHeight]`.
2. Same key found: overwrite value and kind, adjust `size_` by the change in value length, return. `size_` is unsigned, so subtract the old length and add the new one. `length_` does not change.
3. New key: pick a height, raise `height_` (with `head_` as predecessor) if needed, create the node with `NewNode`, and splice it into every level it reaches: `n->next[i] = prev[i]->next[i]`, then `prev[i]->next[i] = n`.
4. `++length_`, `size_ += EntrySize(key, value)`. Compute the size **before** moving `key` and `value` into the node.

> [!tip] Who owns the nodes
> The list owns every node through `arena_` (`NewNode` puts it there), and the `next` links are plain pointers into it. Nodes are freed all at once when the list is destroyed. LevelDB's memtable uses the same arena idea.
<!-- /lang -->

## Deletes are writes
<!-- mode: read-and-implement tasks:1.3 -->

### Why you cannot just remove the key

Picture a key that was written long ago and already flushed to an SSTable on disk. Now the user deletes it. If the memtable simply forgets the key, the next `Get` misses the memtable, checks the disk, finds the old value, and returns it. The deleted key comes back.

```plaintext
  Get("order:7")
     │
     ├─ memtable:   (nothing)             ← delete was "removed", so no record
     │
     └─ SSTable 3:  order:7 = "paid"      ← old value wins. Deleted data is back.
```

The fix is to **record** the delete. A **tombstone** is an entry that says "this key was deleted at this point". It sits in the memtable like any other write, gets flushed to disk like any other write, and shadows older values the same way a newer `Put` would. It only disappears during compaction (chapter 5), once no older value is left for it to hide.

> [!takeaway] In an LSM tree, a delete is a write
> `Delete` stores a tombstone. It even stores one for a key the memtable has never seen,
> because that key may still live in an older file.

### Three answers, not two

To a user, a lookup has two answers: there is a value, or there is not. Inside the LSM tree each table has **three**:

| Result | Meaning | What the read path does next (chapter 4) |
| --- | --- | --- |
| `Found` | This table has a live value | Return it, stop |
| `Deleted` | This table has a tombstone | Return "not found", **stop** |
| `Missing` | This table knows nothing about the key | Keep looking in older tables |

`Deleted` and `Missing` look the same to the user and mean opposite things to the engine. Getting that difference right is what keeps deleted data deleted.

<!-- lang: go -->
### `TODO(1.3)` — `Delete` and `Get`

In `internal/memtable/memtable.go`:

- `Delete`: copy the key the same way `Put` does, take the write lock, and `m.list.put(k, nil, KindTombstone)`.
- `Get`: take the read lock, `m.list.get(key)`, and map no node, tombstone, and live value to `Missing`, `Deleted`, and `Found`. Only `Found` returns a value.

> [!scope] Locking
> `Memtable` uses a read/write mutex: one writer at a time, many concurrent readers.
> The skiplist itself is not thread-safe, which keeps it simple. Production engines
> make the skiplist lock-free for readers; that is out of scope here.
<!-- /lang -->
<!-- lang: python -->
### `TODO(1.3)` — `delete` and `get`

In `lsmkv/memtable/memtable.py`:

- `delete`: copy the key with `bytes(key)` the same way `put` does, take the lock, and `self._list.put(k, None, Kind.TOMBSTONE)`.
- `get`: take the lock, `self._list.get(key)`, and map no node, tombstone, and live value to `(None, Result.MISSING)`, `(None, Result.DELETED)`, and `(node.value, Result.FOUND)`.

> [!scope] Locking
> Python's standard library has no read/write lock, so one `threading.Lock` guards
> both reads and writes. The skiplist itself is not thread-safe, which keeps it simple.
> Production engines make the skiplist lock-free for readers; that is out of scope here.
<!-- /lang -->
<!-- lang: cpp -->
### `TODO(1.3)` — `Delete` and `Get`

In `src/memtable/memtable.cc`:

- `Delete`: take the write lock (`std::unique_lock`, like `Put`) and `list_.Put(std::string(key), "", Kind::kTombstone)`.
- `Get`: take the read lock (`std::shared_lock`), `list_.Get(key)`, and map no node, tombstone, and live value to `kMissing`, `kDeleted`, and `kFound`. Only `kFound` writes to `*value`.

> [!scope] Locking
> `Memtable` uses a `std::shared_mutex`: one writer at a time, many concurrent readers.
> The skiplist itself is not thread-safe, which keeps it simple. Production engines
> make the skiplist lock-free for readers; that is out of scope here.
<!-- /lang -->

## Walking in order
<!-- mode: read-and-implement tasks:1.4 -->

### Why iteration matters

Chapter 3 flushes a full memtable by walking it from the smallest key to the largest and writing each entry, tombstones included, into a sorted file. Range scans (`scan order:100 .. order:200`) need the same walk, starting from a given key.

Level 0 of the skiplist already **is** the sorted list. Upper levels are only for getting somewhere fast.

```plaintext
  Seek("c")  ── use the express lanes to land on the first key >= "c"
       │
       ▼
  level 0:  a ─▶ b ─▶ [d] ─▶ f ─▶ k ─▶ nil
                       │
                 Next ─┴──▶ f ──▶ k ──▶ nil (Valid() == false)
```

<!-- lang: go -->
### `TODO(1.4)` — `Seek` and `Next`

In `internal/memtable/iterator.go`:

- `Seek(target)`: the search from task 1.1 already returns the first node with key `>=` target. Position the iterator there. No `prev` array is needed.
- `Next`: step to the next node on level 0.

`SeekToFirst`, `Valid`, `Key`, `Value`, and `Kind` are given.
<!-- /lang -->
<!-- lang: python -->
### `TODO(1.4)` — `seek` and `next`

In `lsmkv/memtable/iterator.py`:

- `seek(target)`: the search from task 1.1 already returns the first node with key `>=` target. Position the iterator there. No `prev` list is needed.
- `next()`: step to the next node on level 0.

`seek_to_first`, `valid`, `key`, `value`, and `kind` are given.
<!-- /lang -->
<!-- lang: cpp -->
### `TODO(1.4)` — `Seek` and `Next`

In `src/memtable/iterator.cc`:

- `Seek(target)`: the search from task 1.1 already returns the first node with key `>=` target. Position the iterator there. Pass `nullptr` for `prev`.
- `Next`: step to the next node on level 0.

`SeekToFirst`, `Valid`, `Key`, `Value`, and `kind` are given in `iterator.h`.
<!-- /lang -->

> [!warn] Iterators take no lock
> An iterator walks the list without holding the memtable's lock. That is safe for a
> memtable that has been **frozen** (chapter 3 freezes it before flushing), but not
> while another thread is still writing to it.

## Prove it
<!-- mode: read-only -->

<!-- lang: go -->
```bash
make test     # every acceptance test
make race     # the same tests with the race detector
make bench    # Put and Get timings
make run      # a REPL over your memtable
```
<!-- /lang -->
<!-- lang: python -->
```bash
make test     # every acceptance test (python3 -m unittest)
make run      # a REPL over your memtable
```
<!-- /lang -->
<!-- lang: cpp -->
```bash
make test     # build and run every acceptance test
make asan     # the same tests under AddressSanitizer + UBSan
make run      # a REPL over your memtable
```
<!-- /lang -->

Try the REPL:

```plaintext
> put order:2 paid
> put order:1 pending
> del order:2
> get order:2
(deleted)
> get order:9
(missing)
> scan
order:1  "pending"
order:2  (tombstone)
```

> [!check] Before you move on
> Say these out loud:
>
> 1. An LSM tree turns random writes into sequential ones by buffering in memory and
>    writing sorted files.
> 2. A skiplist search walks right, drops down, and never restarts from the head.
> 3. A delete is a tombstone, because older files may still hold the key.
> 4. A lookup in one table answers `Found`, `Deleted`, or `Missing`, and only
>    `Missing` means "keep looking".

### What is missing

Kill the REPL and everything is gone. The memtable lives only in RAM. Chapter 2 adds the **write-ahead log**: every write is appended to a file before it is acknowledged, and on startup the log is replayed to rebuild the memtable.
