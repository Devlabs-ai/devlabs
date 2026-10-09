# lsmkv

A log-structured merge tree in Go, built chapter by chapter. This repo starts
with the in-memory half: the memtable every write lands in first.

```
cmd/lsmkv/main.go                  tiny REPL over the memtable (given)
internal/memtable/skiplist.go      the sorted structure      <- TODO 1.1, 1.2
internal/memtable/memtable.go      Put / Delete / Get        <- TODO 1.3
internal/memtable/iterator.go      ordered walk + Seek       <- TODO 1.4
internal/memtable/memtable_test.go acceptance tests (given)
```

## Your work

| Task | Where | What |
| --- | --- | --- |
| 1.1 | `skiplist.go` `findGreaterOrEqual` | Walk the express lanes down to the first key >= target |
| 1.2 | `skiplist.go` `put` | Overwrite in place, or splice a new node into every level it reaches |
| 1.3 | `memtable.go` `Delete`, `Get` | Deletes write tombstones; Get answers Found, Deleted, or Missing |
| 1.4 | `iterator.go` `Seek`, `Next` | Position on the first key >= target, then walk level 0 |

## Running

```
make test     # go test ./...
make race     # same, with the race detector
make bench    # Put / Get benchmarks
make run      # REPL: put k v | get k | del k | scan [from] | stats | quit
```
