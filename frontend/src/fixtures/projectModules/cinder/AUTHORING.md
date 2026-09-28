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

Each chapter’s `theory.md` is a sequence of **sub-chapters** (`##` headings). Every
sub-chapter is read through. Mark mode with an HTML comment on the line after `##`:

```markdown
## Why Cinder needs one thread
<!-- mode: read-only -->

## What Register and Run do
<!-- mode: read-and-implement tasks:1.1,1.2 -->
```

- **Read only** — own the idea; no code change in this section.
- **Read and Implement** — read, then complete the listed `TODO(id)` tasks before moving on.

Full depth (motivation, mechanics, seams) with **hand-drawn figures** (under
`frontend/public/…`) and typed highlight boxes — not a thin stub and not ASCII walls.

Highlight boxes use blockquote alerts the theory renderer understands:

```markdown
> [!idea] Title
> Body…

> [!warn] …
> [!takeaway] …
> [!scope] …
> [!check] …
> [!tip] …
```

Mode labels show in the majors theory brief.

## Branch rule

Work chapter-by-chapter on branches off `cinder/curriculum-v01`, e.g.
`cinder/ch1-event-loop`, then merge when that chapter’s fixture + theory land.

## Chapter 1 notes

Scratch tree: `internal/eventloop` (student TODOs) plus author-owned
`cmd/cinder/main.go` and `internal/server` — a toy CRLF front end on the loop
(`PING` / `ECHO` / `QUIT`). No CSP / keyspace yet. Writable interest taught in
theory; production interest stays Readable-first.
