# lsmkv (C++)

A log-structured merge tree in C++, built chapter by chapter. This repo starts
with the in-memory half: the memtable every write lands in first.

Needs a C++17 compiler (`g++` 9+ or `clang++` 10+) and `make`. No CMake and no
test framework: `tests/check.h` is a 100-line harness.

```
cmd/lsmkv/main.cc            tiny REPL over the memtable (given)
src/memtable/skiplist.h/.cc  the sorted structure      <- TODO 1.1, 1.2
src/memtable/memtable.h/.cc  Put / Delete / Get        <- TODO 1.3
src/memtable/iterator.h/.cc  ordered walk + Seek       <- TODO 1.4
tests/memtable_test.cc       acceptance tests (given)
```

## Your work

| Task | Where | What |
| --- | --- | --- |
| 1.1 | `skiplist.cc` `FindGreaterOrEqual` | Walk the express lanes down to the first key >= target |
| 1.2 | `skiplist.cc` `Put` | Overwrite in place, or splice a new node into every level it reaches |
| 1.3 | `memtable.cc` `Delete`, `Get` | Deletes write tombstones; Get answers kFound, kDeleted, or kMissing |
| 1.4 | `iterator.cc` `Seek`, `Next` | Position on the first key >= target, then walk level 0 |

## Running

```
make test     # build and run the tests
make asan     # same tests with AddressSanitizer + UBSan
make run      # REPL: put k v | get k | del k | scan [from] | stats | quit
```

On some recent macOS versions AddressSanitizer hangs before `main` runs. If
`make asan` prints nothing, run it on Linux or in a container, for example
`docker run --rm -v "$PWD":/src -w /src gcc:13 make asan`.
