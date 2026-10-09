# LSM tree minor — authoring model

A chaptered minor: `constants/minors.ts` lists the chapters, and each `ready`
chapter has a fixture per language registered in `MINOR_CHAPTER_CONTENT`
(`fixtures/projectModules/index.ts`), keyed `minor/chapter/language`. The minor
stays `planned` (admin preview only) until enough chapters are authored to launch.

Languages are Go, Python and C++ (`languages` on the minor entry). The learner
picks one on the minor page; it travels as `?lang=` and is remembered per minor.

## Chapters

| # | id | Status | Student focus | Author-owned (grows over time) |
| --- | --- | --- | --- | --- |
| 0 | `overview` | **ready** | reading only (`lsmTreeOverview.ts`, same shape as track blogs): what, where it is used, the plan | keep the chapter table in sync with `minors.ts` |
| 1 | `memtable` | **ready** (go, python, cpp) | skiplist search + put, tombstones, iterator | build files, REPL entry point |
| 2 | `write-ahead-log` | planned | WAL record format, append, replay, torn tail | REPL opens a data dir; memtable writes go through the WAL |
| 3 | `sstable` | planned | SSTable writer + reader, index, footer | flush trigger on approximate size, frozen memtable swap |
| 4 | `read-path` | planned | Bloom filter, newest-first get, merging iterator | db wiring |
| 5 | `compaction` | planned | k-way merge, tombstone dropping, manifest swap | background trigger, `stats` output |

## Layout

```
<chapter>/
  theory.md            shared by every language
  go/files/            starter repo      go/solution/      edited files only
  python/files/        starter repo      python/solution/
  cpp/files/           starter repo      cpp/solution/
```

## Rules

- Same scratch-repo rule as Cinder: chapter N ships only the files it needs,
  plus earlier chapters' student code filled in.
- Task ids are `N.x`. Every block of a task uses the same `TODO(N.x)` marker,
  because the workspace counts a task done when its marker is gone from the file.
- Task ids, task count and test cases are the same in every language. A port
  changes syntax and idiom, never what the chapter teaches or checks.
- `theory.md` is shared. Anything that names a function, type, file or command
  goes inside `<!-- lang: go -->` … `<!-- /lang -->` (a block may list several,
  e.g. `<!-- lang: python, cpp -->`). Text outside lang blocks shows for all.
- Do not hard-wrap `theory.md`. The theory renderer turns every source line into its
  own paragraph, so write one line per paragraph or list item.
- A chapter is done when its tests pass. Tests are given; they must fail with a
  clear message (or a `TODO` panic / exception) on the starter and pass on `solution/`.
- No third-party dependencies: Go stdlib, Python stdlib `unittest` (3.9+),
  C++17 with a plain Makefile and `tests/check.h`.
- `solution/` holds only the files students edit. It is never imported, so it
  never ships in the bundle.

## Verifying a chapter

```bash
SRC=frontend/src/fixtures/projectModules/minors/lsm-tree/<chapter>
T=$(mktemp -d)
for L in go python cpp; do
  cp -R $SRC/$L/files $T/$L && cp -R $SRC/$L/solution/. $T/$L/
done
(cd $T/go && gofmt -l . && go vet ./... && make test && make race)
(cd $T/python && make test)
(cd $T/cpp && make test)
# AddressSanitizer hangs on recent macOS clang; run it in Linux instead:
docker run --rm -v "$T/cpp":/src -w /src gcc:13 make asan
```

Also run the starters (`files/` alone) and confirm every task's tests fail.
