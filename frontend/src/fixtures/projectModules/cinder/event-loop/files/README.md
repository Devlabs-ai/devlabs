# Cinder — the event loop

Same server, same protocol, same tests. One thread instead of one goroutine per
connection, driven by epoll (Linux) or kqueue (macOS/BSD).

## Layout

```
cmd/cinder/main.go              unchanged wiring: config, signals, run
internal/config/config.go       + Backlog, MaxEvents, PollTimeoutMs
internal/logx/logx.go           tiny leveled logger
internal/proto/line.go          + NextFrame: framing over a byte buffer
internal/evloop/poller.go       Kind, Event, Poller interface
internal/evloop/poller_linux.go   epoll implementation (given)
internal/evloop/poller_darwin.go  kqueue implementation (given)
internal/evloop/loop.go         the loop            <- TODO 2.1, 2.2
internal/evloop/loop_test.go    loop-level tests
internal/server/server.go       accept + read + flush  <- TODO 2.3, 2.4
internal/server/conn.go         per-connection buffers (no mutexes, by design)
internal/server/server_test.go  blocking-server tests, plus new ones
scripts/smoke.sh                end-to-end check through nc
```

## Your work

| Task | Where | What |
| --- | --- | --- |
| 2.1 | `loop.go` `Register` | Non-blocking mode, then add to the poller |
| 2.2 | `loop.go` `Run` | Wait, dispatch, survive EINTR, stop cleanly |
| 2.3 | `server.go` `onAccept` | Accept until EAGAIN, register each client |
| 2.4 | `server.go` `onReadable` | Read until EAGAIN, frame, execute, flush |

Start with 2.1 and 2.2 and run `go test ./internal/evloop/` — those tests use a
socketpair and do not need the server at all. Then do 2.3 and 2.4.

## Rules this module enforces

1. **Nothing on the loop thread may block.** Every descriptor is non-blocking;
   `EAGAIN` is a normal outcome, not an error.
2. **Read until `EAGAIN`.** One read per event throws away throughput and, under
   edge-triggered pollers, loses data outright.
3. **Arm write interest only while bytes are pending.** An idle socket is
   writable, so a permanently armed fd is a permanent wakeup — 100% CPU at rest.
4. **State has one owner.** Anything from another goroutine goes through
   `Loop.Post`. There is not a single mutex in the connection path, and there
   should not be.

## Running

```
make run
make test        # go test ./...
make race        # go test -race ./... — this is the one that matters here
make smoke
```
