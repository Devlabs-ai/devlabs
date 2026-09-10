# The event loop

If the [TCP server](/play/minors/tcp-server) minor is still foggy, do that first.
It is the right model for most Go servers: one goroutine per connection, each
parked on a blocking `Read`.

It is the wrong model for Cinder.

Cinder's keyspace, TTL logic, and append-only log will all hang off **one
thread**. Shared state without locks only works if a single scheduler owns every
mutation. This chapter builds that scheduler: a readiness loop. Later chapters
add protocol, commands, and storage as callbacks on the same loop — they never
take the mutex you would need in a goroutine-per-conn design.

```plaintext
                    .--------------------------------------------.
                    |              one OS thread                  |
                    |                                             |
   kernel           |   Wait() ──▶ which fds are ready?           |
   readiness   ───▶ |        │                                    |
   (epoll/kqueue)   |        ▼                                    |
                    |   OnReadable / OnWritable  (one at a time)  |
                    |        │                                    |
                    |        ▼                                    |
                    |   accept / read / (later) command / store   |
                    '--------------------------------------------'
                                      ▲
                                      │  Post(fn) from elsewhere
                                      │  (signals, timers, …)
```

Nothing in this chapter speaks CSP or stores a key. The scratch tree is the
event loop plus a **tiny author-owned server** (`cmd/cinder`, `internal/server`)
so you can see real accepts and reads once `Register` / `Run` work. You write
those two methods; pollers and the request path around them are given.

## Why blocking reads do not scale here

A blocking `read` parks the calling thread until data arrives. N clients then
need N threads of execution, because any of them might be the one with bytes.

```plaintext
  blocking model                         readiness model

  client A ── Read ──▶ goroutine A       client A ─┐
  client B ── Read ──▶ goroutine B       client B ─┼──▶  one Wait()
  client C ── Read ──▶ goroutine C       client C ─┘         │
       │                                                      ▼
       └── shared map needs a mutex              single handler,
                                                 no mutex on the dict
```

Goroutines make the left side cheap, not free:

- Idle connections still cost stack and scheduler entries.
- The dict needs a lock; every `GET`/`SET` pays for it.
- Order across clients is the scheduler's choice — awkward for an append-only
  log that wants a clear sequence.

The right side asks the kernel once: "which of these descriptors can I touch
without blocking?" Then one thread runs the work to completion.

## Readiness notification

| Mechanism | Where | Cost | Shape |
| --- | --- | --- | --- |
| `select` / `poll` | POSIX | O(N) | rescans the whole set |
| `epoll` | Linux | O(ready) | interest set lives in the kernel |
| `kqueue` | BSD / macOS | O(ready) | same idea, different API |

These are **readiness** APIs: the kernel says a call *would not block*; you
still perform the `read` / `write` / `accept` yourself. (`io_uring` is a
completion API — different model; Cinder does not use it.)

The starter wraps epoll and kqueue behind one interface. You never call them
directly:

```plaintext
                 ┌────────────┐
                 │   Loop     │
                 │ Register   │
                 │ Run / Post │
                 └─────┬──────┘
                       │ Poller
           ┌───────────┴───────────┐
           ▼                       ▼
    poller_linux.go          poller_darwin.go
         epoll                    kqueue
```

```go
type Poller interface {
    Add(fd int, interest Kind) error
    Modify(fd int, interest Kind) error
    Remove(fd int) error
    Wait(events []Event, timeoutMs int) (int, error)
    Close() error
}
```

Interest is a bitset: `Readable`, `Writable`, or both. Level-triggered: a fd
keeps showing up as ready until the condition clears (you drained the socket,
or the listen backlog is empty).

## Non-blocking is not optional

Readiness without `O_NONBLOCK` is a deadlock waiting to happen.

```plaintext
  kernel:  "fd 7 is readable"  ─────────────────────┐
                                                    ▼
  your loop:  read(7)  … but the packet was already
              consumed / checksum-failed / …
                    │
                    ▼
              blocking read  →  parks the ONLY thread
                    │
                    ▼
              every other client waits forever
```

Two rules:

1. Drain until `EAGAIN`. That is how you know you are done for now.
2. Treat stale readiness as normal. The report is a hint, not a promise that
   the next `read` returns data.

`Register` must set non-blocking **before** the fd enters the poller.

## Level-triggered vs edge-triggered

```plaintext
  level (what we use)              edge (EPOLLET)

  data arrives ──▶ ready           data arrives ──▶ ready once
  you read some ──▶ still ready    you read some ──▶ silent
  you read to EAGAIN ──▶ quiet     remaining bytes sit forever
                                   unless more data arrives
```

Level-triggered forgives partial reads. Still read until `EAGAIN`: one read per
`Wait` throws away throughput under pipelining.

## Writes — know the trap, defer the full fix

A `write` can accept only part of your buffer. The durable fix is an out buffer
plus **write-interest arming**: register `Writable` only while bytes are
pending, then disarm when the buffer empties.

```plaintext
  naive: leave Writable armed always

       Wait ──▶ writable ──▶ try write ──▶ still writable ──▶ …
                 ▲________________________________________│
                      busy loop, 100% CPU at idle

  correct (later): arm only while outbuffer.len > 0
```

**This chapter does not require arming Writable in a server.** The `Handler`
keeps `OnWritable`, and `Run` should still dispatch writable **before**
readable so a later chapter can plug in without reshuffling order. Today
socketpair tests may register `Writable` on purpose; production interest for
Cinder V0.1 stays Readable-first when the server arrives.

## What `Run` actually does

```plaintext
                 ┌──────────────────────────────┐
                 │  LockOSThread()              │
                 │                              │
         .──────▶│  drain Post tasks            │
         │       │           │                  │
         │       │           ▼                  │
         │       │  poller.Wait(events, timeout)│
         │       │           │                  │
         │       │     EINTR? ──yes──▶ loop     │
         │       │           │                  │
         │       │           ▼                  │
         │       │  for each event:             │
         │       │    Writable? → OnWritable    │
         │       │    Readable? → OnReadable    │
         │       │  (handler err → next event)  │
         │       │           │                  │
         │       │  stopped? ──no───────────────'
         │       │     │
         │       │    yes → drain tasks, return
         │       └──────────────────────────────┘
         │
    Stop() / timeout wake / more events
```

Pinning the OS thread keeps the hot path on one core. `Post` is how other
goroutines (signals, later timers) schedule work onto that thread without
touching store state themselves. A small positive `timeoutMs` is how `Stop` and
`Post` get noticed without a dedicated wakeup fd: `Wait` returns, you drain
tasks, you check the flag.

## From `main` to a request

`cmd/cinder/main.go` is given. It builds the server, catches Ctrl-C as
`Shutdown`, and blocks in `Start` → `loop.Run()`. The server is the `Handler`:

```plaintext
  main
    │
    ├─ signal.Notify ──▶ Shutdown() ──▶ loop.Stop()
    │
    └─ server.Start()
           │
           ├─ net.Listen → dup listen fd
           ├─ eventloop.New(server)     // server implements Handler
           ├─ loop.Register(listenFD, Readable)   ← needs your TODO(1.1)
           └─ loop.Run()                          ← needs your TODO(1.2)
                  │
                  ▼
            OnReadable(listenFD) ──▶ Accept until EAGAIN
                  │                   Register(clientFD, Readable)
                  ▼
            OnReadable(clientFD) ──▶ Read until…
                  │                   buffer CRLF lines
                  ▼
            PING → PONG   ECHO → text   QUIT → BYE (close)
```

Toy line protocol only — enough to prove the loop. CSP replaces it in the next
chapter. You do **not** fill in `main` or `server`; if the loop is wrong, `make
run` and `nc` stay silent or hang.

## The two holes

Pollers, `Kind` / `Event`, `New`, `Modify`, `Deregister`, `Post`, `Stop`,
`Close`, and the tests are given. Two bodies panic:

1. **`TODO(1.1)`** — `Loop.Register` in `loop.go`. Set `O_NONBLOCK`, then
   `poller.Add` with the given interest.
2. **`TODO(1.2)`** — `Loop.Run`. Lock the OS thread; loop until `Stop`: drain
   tasks, `Wait`, retry `EINTR`, dispatch writable then readable, ignore
   handler errors for that event, exit cleanly when stopped.

```bash
make test
make race
```

There is no keyspace yet. When the loop tests pass, try `make run` and
`printf 'PING\r\n' | nc 127.0.0.1 7379` — that is the loop carrying a real
request path.
