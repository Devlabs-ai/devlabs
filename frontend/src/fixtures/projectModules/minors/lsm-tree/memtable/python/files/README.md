# lsmkv (Python)

A log-structured merge tree in Python, built chapter by chapter. This repo
starts with the in-memory half: the memtable every write lands in first.

Needs Python 3.9 or newer. No third-party packages: tests use `unittest`.

```
lsmkv/__main__.py               tiny REPL over the memtable (given)
lsmkv/memtable/skiplist.py      the sorted structure      <- TODO 1.1, 1.2
lsmkv/memtable/memtable.py      put / delete / get        <- TODO 1.3
lsmkv/memtable/iterator.py      ordered walk + seek       <- TODO 1.4
tests/test_memtable.py          acceptance tests (given)
```

## Your work

| Task | Where | What |
| --- | --- | --- |
| 1.1 | `skiplist.py` `find_greater_or_equal` | Walk the express lanes down to the first key >= target |
| 1.2 | `skiplist.py` `put` | Overwrite in place, or splice a new node into every level it reaches |
| 1.3 | `memtable.py` `delete`, `get` | Deletes write tombstones; get answers FOUND, DELETED, or MISSING |
| 1.4 | `iterator.py` `seek`, `next` | Position on the first key >= target, then walk level 0 |

## Running

```
make test     # python3 -m unittest
make run      # REPL: put k v | get k | del k | scan [from] | stats | quit
```
