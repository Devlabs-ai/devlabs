# The event loop

A blocking TCP server — one goroutine per connection, each parked on `Read` —
works, and for most Go servers it is the right answer. If that model is not
already in your hands, do the [TCP server](/play/minors/tcp-server) minor first.

It is the wrong answer here, because Cinder's storage engine is single threaded.

In this module you take the concurrency away and get the throughput back: one
thread, non-blocking sockets, and a loop that asks the kernel "which of these
thousands of descriptors can I touch right now?"

This is the module that decides the shape of the rest of the project. Every
later feature — commands, TTL expiry, the append-only log, compaction — is a
callback on this loop.

## The problem with blocking reads

A blocking `read` on a socket with no data parks the calling thread. To serve N
clients you therefore need N threads of execution, because at any moment any of
them might be the one with data. Goroutines make that cheap, not free:

- Each goroutine carries a stack (8 KB minimum, grown on demand) and a
  scheduler entry. 50k idle connections is real memory and real scheduling
  work for zero requests per second.
- Any state they share needs a mutex. For a key–value store, "shared state" is
  the entire point of the program.
- Execution order is the scheduler's choice, so two clients racing on the same
  key have no defined outcome unless you add more locking.

## Readiness notification

The alternative is to ask the kernel about many descriptors at once. You
register interest — "tell me when any of these are readable" — and block in one
place until at least one is. That single call replaces N blocked threads.

| Mechanism | Where | Cost per call | Notes |
| --- | --- | --- | --- |
| `select` / `poll` | POSIX | O(N), rescans the whole set | Portable, fine for hundreds of fds |
| `epoll` | Linux | O(ready), interest set kept in the kernel | What Redis and nginx use on Linux |
| `kqueue` | BSD, macOS | O(ready), same idea | Different API, same model |
| `io_uring` | Linux 5.1+ | Submission/completion queues | Completion based, not readiness based |

The first four are **readiness** APIs: the kernel tells you a call *would not
block*, and you still perform the read yourself. `io_uring` is a **completion**
API: you submit the read and are told when it finished. Cinder uses readiness,
which is the model behind essentially every single-threaded server you have
heard of.

The starter repo already wraps `epoll` and `kqueue` behind one interface:

```go
type Poller interface {
    Add(fd int, interest Kind) error
    Modify(fd int, interest Kind) error
    Remove(fd int) error
    Wait(events []Event, timeoutMs int) (int, error)
    Close() error
}
```

You write the loop that drives it, not the syscall wrappers.

## Non-blocking is not optional

Readiness notification without `O_NONBLOCK` is a deadlock waiting to happen.
Two reasons, and the second one surprises people:

1. You want to read *until the socket is drained*, and the only way to know you
   are done is a read that returns `EAGAIN`. On a blocking fd that read parks
   the loop — and the loop is your entire server.
2. Readiness can be stale. The kernel can report a descriptor readable and the
   data can be gone before you get there (a checksum failure discarding the
   packet, another thread consuming it). A blocking read then hangs forever on
   a socket the kernel *told you* was ready.

So every descriptor the loop touches — the listener included — is switched to
non-blocking, and `EAGAIN` / `EWOULDBLOCK` is a normal control-flow signal
rather than an error.

## Level-triggered vs edge-triggered

- **Level triggered** (the default): "there is data available" is reported on
  every `Wait` until you consume it. Forgiving — a partial read just means you
  get told again.
- **Edge triggered** (`EPOLLET`): only *transitions* are reported. You are told
  once when data arrives, and never again until more arrives. If you stop
  reading before `EAGAIN`, the remaining bytes sit there forever and the client
  hangs.

The starter uses level triggered, which is what Redis does. Even so, you should
read until `EAGAIN`: doing one read per `Wait` costs you a full loop iteration
per read and destroys throughput under pipelining.

## Writes are the hard half

Reads are easy — the kernel buffered the data for you. Writes are where naive
event loops break, because `write` can accept *some* of your bytes:

```plaintext
n, err := write(fd, out)   // len(out) == 40000
// n == 16384, err == nil  ← the socket buffer filled
```

The remaining 23,616 bytes are yours to keep. If you loop and retry
immediately, you spin on `EAGAIN` and burn the CPU that other clients need.

The correct move is **write interest arming**:

1. Try to write. If everything drains, stay registered for read only.
2. If bytes remain, keep them in the connection's out buffer and modify the
   registration to read **and** write.
3. When the loop later reports the fd writable, flush more.
4. Once the out buffer is empty, drop write interest again.

Step 4 matters. A socket with an empty send buffer is almost always writable,
so leaving write interest armed means `Wait` returns immediately, forever. That
is the classic event-loop busy loop, and it looks like 100% CPU at idle.

## One thread, and why it is fast

It sounds like a downgrade. In practice, for a store whose commands are
hash-map operations measured in nanoseconds:

- **No locks on the hot path.** The loop *is* the mutual exclusion. Every
  command runs to completion before the next one starts, which also gives you
  atomicity for free — the property `INCR` needs.
- **No context switches between clients.** The working set stays in L1/L2
  instead of being evicted by another core's turn.
- **Deterministic order.** Commands execute in the order the loop observes
  them, which is what makes replication and an append-only log tractable later.

Redis served millions of ops/sec on one core with exactly this design. The
network stack, not the data structure, is the bottleneck.

The flip side, and the thing to say out loud in an interview: **head-of-line
blocking**. One slow command stalls every client. `KEYS *` on a large keyspace,
or a big range scan, is not a slow request — it is a slow *server* for its whole
duration. That constraint is why real single-threaded stores push large or slow
work into background threads and keep the loop for O(1) operations.

## Where the syscalls come back

A blocking `net.Listen` hides socket/bind/listen. This module opens the
socket by hand, because the loop needs the raw descriptor:

```go
fd, _ := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0)
syscall.SetsockoptInt(fd, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1)
syscall.Bind(fd, sa)
syscall.Listen(fd, cfg.Backlog)
syscall.SetNonblock(fd, true)
```

`SO_REUSEADDR` is what lets you restart the server while the previous socket is
still in `TIME_WAIT`. Without it, a redeploy fails with "address already in
use" for up to two minutes.

One consequence to know about: `AF_INET` is IPv4 only. `net.Listen` gave you a
dual-stack socket for free, so `nc localhost` worked; here
`localhost` resolving to `::1` will not connect. Use `127.0.0.1`. Supporting
both families means either `AF_INET6` with `IPV6_V6ONLY` off, or two listeners
in the loop — a fine exercise, and not required here.

A non-blocking listener also changes `accept`: instead of accepting once per
readiness event, you accept in a loop until `EAGAIN`, because a single
notification may cover several queued connections.

## What you implement

The pollers, buffers, protocol, and tests are given. Four blocks are yours.

1. **`TODO(2.1)`** — `Loop.Register` in `internal/evloop/loop.go`. Put the fd in
   non-blocking mode and add it to the poller.
2. **`TODO(2.2)`** — `Loop.Run`. Wait for events, dispatch readable and writable
   to the handler, survive `EINTR`, exit when stopped.
3. **`TODO(2.3)`** — `Server.onAccept` in `internal/server/server.go`. Drain the
   accept queue, register each client, and refuse gracefully at the fd limit.
4. **`TODO(2.4)`** — `Server.onReadable`. Read until `EAGAIN`, run every complete
   frame in the buffer, and hand the output to the write path so it can arm
   write interest when the socket backs up.

## Verifying

```shell
make loop          # evloop tests only — they pass after 2.1 and 2.2
make test          # acceptance tests over a real socket, plus loop-specific ones
make race          # the one that matters: proves execution never left the loop
make run
printf 'PING\r\n' | nc 127.0.0.1 7379
```

The suite deliberately reuses the blocking-server tests. Swapping the concurrency model
underneath must not change a single observable behaviour — same replies, same
pipelining, same graceful shutdown. That is the whole point of keeping
`New`/`Run`/`Close` stable.

`TestLoopIsSingleThreaded` asserts that every command executes on the same
OS thread. `TestBackpressureArmsWriteInterest` opens a client that never reads,
pushes enough data to fill the socket buffer, and checks that the server neither
blocks nor spins.

## Questions worth being able to answer

- Your loop shows 100% CPU with zero clients connected. What is the most likely
  bug, and which line fixes it?
- Under edge-triggered mode, a client sends 10 KB and your handler reads 4 KB
  and returns. What happens next, and when?
- Why is `accept` in a loop until `EAGAIN` rather than once per event?
- A command takes 200 ms. How many clients are affected, and what would you
  change to keep the p99 for everyone else?
- The loop is single threaded, yet the process shows several OS threads. Where
  did they come from?
