# Cinder V0.1 — authoring model

Reference: [memkv `v0.1.0`](https://github.com/Rithvik89/memkv/releases/tag/v0.1.0).

## Chapters (no pub/sub, no streams)

| # | id | Status | Student focus | Author-owned (grows over time) |
| --- | --- | --- | --- | --- |
| 1 | `event-loop` | **ready** | `Register` + `Run` | go.mod, Makefile; pollers given |
| 2 | `csp-protocol` | planned | `internal/proto` | wire server to Decode when ready |
| 3 | `commands` | planned | `internal/command`, `cmd/cli` | register verbs |
| 4 | `keyspace` | planned | `internal/store` lazy TTL | — |
| 5 | `append-only-log` | planned | `internal/wal` write + fsync | Store appends before ACK |
| 6 | `recovery` | planned | torn-tail repair + replay | Open path |
| 7 | `compaction` | planned | Rewrite + Compact | maintenance API |
| 8 | `benchmarks` | planned | `info` + `cmd/bench` + INFO | counters hooked earlier |

## Scratch repo rule

- Chapter **N** fixture contains **only** files that chapter needs (plus prior
  chapter solutions as filled code, not a dump of the finished tree).
- New packages appear as **placeholder files** when their chapter opens — not in
  chapter 1.
- Logger, `cmd/server`, Makefile, smoke scripts: **authors** add/update them
  across chapters. Students do not implement those blocks as big TODOs in ch1.

## Theory rule

Each chapter’s `theory.md` should be full depth (motivation, mechanics, seams,
checklist) with **ASCII / hand-drawn-feel block diagrams** — not a thin stub.

## Branch rule

Work chapter-by-chapter on branches off `cinder/curriculum-v01`, e.g.
`cinder/ch1-event-loop`, then merge when that chapter’s fixture + theory land.

## Chapter 1 notes

Scratch tree: `internal/eventloop` (student TODOs) plus author-owned
`cmd/cinder/main.go` and `internal/server` — a toy CRLF front end on the loop
(`PING` / `ECHO` / `QUIT`). No CSP / keyspace yet. Writable interest taught in
theory; production interest stays Readable-first.
