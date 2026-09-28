## Why Cinder needs one thread
<!-- mode: read-only -->

### Where you are

You signed up to build **Cinder** — a small key–value store, sitting by sitting.
Over the major you will grow an in-memory **dict** (hash map of keys to values), a wire
protocol, and commands like `GET` / `SET` — all sitting on top of one I/O engine.

This chapter is not about keys yet. It is about the **engine room**: who is allowed to
touch the shared dict, and in what order.

> [!idea] Does this whole store run on a single thread?
> No, not really. The “single thread” idea people hear about is **only** about processing
> and handling data **in memory**.
>
> Other work still needs parallelism: concurrent users on the network, background jobs
> (compaction and similar — later chapters), and more. So Cinder is not “one thread for
> the entire product.” We are saying: **when it comes to the in-memory dict, only one
> thread mutates it** — so we avoid race-style bugs on the map.

### The store you are aiming at

Picture three clients talking to Cinder at once:

![Three clients at the same moment: SET, GET, SET arrows into Cinder](/cinder/event-loop/cinder-ch1-three-clients.png)

Cinder must decide, for every mutation:

- which value is in the **dict** right now,
- whether that `GET` sees alice, bob, or a half-updated mess,
- who “won” if two `SET`s race on the same key.

Those are not “nice to have” details. They **are** the product. A KV store is a story
about **ordered changes to a shared hash map**.

### The familiar answer — and why we reject it here

If you have written a typical Go TCP server (accept, then a handler per
connection), you already know the comfortable pattern:

![One process per client: accept a connection, then a blocking handler per client](/cinder/event-loop/cinder-ch1-go-per-conn.png)

That model is excellent for many servers. Each client gets its own stack. The runtime
schedules parallel executions. When a client is idle, its thread (or goroutine) just
waits on `Read`.

For Cinder it creates a problem you can feel already:

![Many handlers all poking one shared dict — who wins?](/cinder/event-loop/cinder-ch1-shared-dict.png)

If A and C both `SET` the same key, who wins? If B `GET`s in the middle, what does it
see? Two handlers writing the same map entry without coordination is undefined behavior
in the worst case — and a mutex in the “lucky” case.

> [!warn] The usual patch
> Wrap the dict in a **mutex**. That works — and quietly turns your “simple” store into
> a concurrent program where every hot path pays for locking, and every ordering bug is
> a heisenbug.

**What is the issue with that?** The operations themselves are **in memory** — often just
a few microseconds — once you set aside network round-trips, serialization, and other
overheads. Locks and the ceremony around them can cost a surprising amount of time next
to that tiny critical section. Redis, a popular in-memory KV store, was designed early
around this idea: **do not let multiple threads touch the memory dict**, or the hot path
gets more complex and slower than the work you actually care about.

> [!idea] Cinder’s bet
> **One OS thread owns every mutation to the dict.** No lock on the map. Order is
> “whatever this thread did last.”

That is not because concurrency is evil. It is because **this** project wants the mental
model of Redis-style single-threaded command execution: one command finishes before the
next one starts touching the dict.

### One thread does not mean one client

“One thread” sounds like “one client at a time, everyone else waits on the network.”
That would be a terrible chat server. Cinder is not stuck that way.

The trick — which the next sections unpack — is **readiness**:

- Many clients can be connected at once.
- The kernel tells you which sockets have work **right now**.
- Your one thread runs that work to completion (accept, read, later: decode, command,
  dict update), then asks the kernel again.

![One OS thread: Wait, handle one ready socket, repeat — many clients outside](/cinder/event-loop/cinder-ch1-one-thread.png)

From the outside: lots of clients. From the inside: **one narrator** for the dict.

Later chapters hang off that narrator as callbacks on the same loop. They never need to
ask “do I hold the lock?” — if your code is running on the loop thread, you already own
the map.

### What this chapter builds (and what it does not)

| You build / own now | Still later |
| --- | --- |
| The readiness **loop** (`Register`, `Run`) | CSP wire protocol |
| Mental model: one scheduler for all I/O | `GET` / `SET` and the in-memory dict |
| Proof: toy `PING` / `ECHO` over the loop | Richer commands on that same loop |

> [!scope] This chapter’s job
> You are **not** implementing the dict here. You are implementing the **heartbeat** the
> dict will eventually sync to. Pollers and a tiny proof server are already in the scratch
> repo — once your loop works, real accepts and reads show up.

### What “own this section” means

> [!check] Before you move on
> Say these out loud:
>
> 1. Cinder’s correctness is about **ordered updates to a shared dict**.
> 2. One-handler-per-connection + a shared map means **locks** (or races).
> 3. “One thread” here means **one narrator for the in-memory dict** — not the whole process forever.
> 4. Many clients still work — that dict thread only runs when a socket is **ready** (next section).

When that feels solid, open **Blocking vs readiness** and see the two models side by
side.

## Blocking vs readiness
<!-- mode: read-only -->

### Where section 1 left you

You already own the product bet: **one OS thread narrates every mutation to the
in-memory dict**. Many clients still connect at once. The open question is *how*
that one thread notices work without parking forever on a single quiet socket.

This section is that mechanism — **blocking I/O** vs **readiness** — still with no
dict code. You are choosing how the engine room wakes up.

### The default you already know: blocking read

A normal `Read` on a socket is **blocking**: the calling thread of execution sits
inside the kernel until at least one byte arrives (or the peer closes, or an error
fires). That is fine when the thread has nothing else to do.

![One process per client: accept a connection, then a blocking handler per client](/cinder/event-loop/cinder-ch1-go-per-conn.png)

In the familiar server, each connection gets its own goroutine (or thread). Client A
blocks in `Read`. Client B blocks in `Read`. Client C blocks in `Read`. When B’s
packet lands, only B’s handler wakes. A and C stay parked — that is what you want
*for them*.

> [!idea] Why N clients need N waiters
> Under blocking I/O, **whoever is waiting for a particular socket must be a
> separate waiter**. One thread cannot `Read` A and also notice that B became ready
> — it is stuck inside A’s `Read` until A speaks.

So the left-hand mental model is forced:

| Blocking world | Consequence for Cinder |
| --- | --- |
| One waiter per open connection | Many concurrent handlers |
| Handlers share one dict | Mutex (or races) — section 1 |
| Idle clients still occupy a stack / scheduler slot | Cost grows with *connections*, not with *active work* |
| Who runs next is the runtime’s choice | Dict order is a heisenbug unless you lock carefully |

Goroutines make the left side **cheap**, not **free** — and they do not remove the
dict problem. They only make “spin up another waiter” feel painless until the map
needs a single clear story.

### Readiness: ask once, then handle who is ready

Readiness flips the question. Instead of “block until *this* fd has data,” you ask
the kernel:

> Among **all** the fds I care about, which ones can I touch **right now** without
> blocking?

That question is one call — we will call it `Wait()` in the diagrams. It may block
until *someone* is ready (or a timeout fires). When it returns, you get a short
list: “fd 7 readable, fd 12 readable, …” Your **one** thread then runs that work to
completion (accept, read, later: decode / command / dict), and calls `Wait()` again.

![One OS thread: Wait, handle one ready socket, repeat — many clients outside](/cinder/event-loop/cinder-ch1-one-thread.png)

From the outside: lots of clients, same as before. From the inside: **one narrator**
only runs when the kernel says there is something to do.

> [!takeaway] Blocking vs readiness in one line
> Blocking = “park me on **this** socket.” Readiness = “wake me when **any** of these
> sockets is workable — then I choose what to do.”

### “But Wait() still blocks?” — yes, and that is the point

People hear “non-blocking server” and think nothing ever waits. Wrong layer.

| Call | Blocks? | On what? |
| --- | --- | --- |
| `Read` on a quiet socket (blocking mode) | Yes | **That** client |
| `Wait()` with no ready fds | Yes | **Any** interesting fd (or timeout) |
| `Read` after the kernel said readable + `O_NONBLOCK` | No (or short) | Returns data or `EAGAIN` |

Your loop thread is allowed to sleep inside `Wait()`. While it sleeps, **no dict
mutation is in flight** — which is fine. When it wakes, it is the only writer.
Other clients are not “running in parallel on the map”; they are sitting in the
kernel’s interest set until their turn comes.

> [!warn] The trap this chapter exists to prevent
> If you ever do a **blocking** `Read`/`Accept` on the loop thread *outside* the
> readiness contract, you park the **only** narrator. Every other client freezes
> even though their sockets may already be ready. Section 4 makes `O_NONBLOCK`
> non-negotiable for that reason.

### Idle connections are cheap on the readiness side

Under blocking-per-connection, an idle client still owns a waiter.

Under readiness:

- Idle clients cost an **fd** and an entry in the poller’s interest set.
- They do **not** own a runnable handler until `Wait()` names them.
- Burst traffic is handled in a burst of loop iterations; silence is just another
  `Wait()`.

That is why Redis-style designs can hold huge connection counts on one command
thread: most sockets are quiet most of the time, and quiet is almost free at the
application layer.

### Order: the dict story you wanted in section 1

On the readiness path, command execution is serialized by construction:

1. `Wait()` returns a batch of ready fds.
2. Your loop handles them **one after another** on the same thread.
3. Each command that will someday touch the dict finishes before the next one
   starts.

There is no mutex on the map because there is no second narrator. If A’s `SET` and
B’s `SET` both become readable in the same batch, **your dispatch order** decides
who wins — not the Go scheduler racing two goroutines into `map.assign`.

> [!scope] Still not building the dict
> You are only owning *when* work runs. Wire protocol and `GET` / `SET` arrive in
> later chapters, hanging off this same loop. The poller API in the next section is
> the concrete `Wait()` Cinder wraps for Linux and macOS.

### What “own this section” means

> [!check] Before you move on
> Say these out loud:
>
> 1. Blocking `Read` parks **one waiter on one socket** — so N clients push you toward N waiters.
> 2. Readiness asks the kernel **which fds are workable now**, then one thread runs that work.
> 3. `Wait()` may block the loop thread; that is sleep on “any work,” not sleep on “client A.”
> 4. A blocking call on the loop thread starves every other client — readiness only helps if handlers stay non-blocking (next sections).

When that feels solid, open **The poller you are given** and see the Linux / macOS
APIs behind `Wait()`.

## The poller you are given
<!-- mode: read-only -->

| Mechanism | Where | Cost | Shape |
| --- | --- | --- | --- |
| `select` / `poll` | POSIX | O(N) | rescans the whole set |
| `epoll` | Linux | O(ready) | interest set lives in the kernel |
| `kqueue` | BSD / macOS | O(ready) | same idea, different API |

These are **readiness** APIs: the kernel says a call *would not block*; you still perform the
`read` / `write` / `accept` yourself. (`io_uring` is a completion API — Cinder does not use it.)

The starter wraps epoll and kqueue behind one interface. You never call them directly:

```plaintext
                    ┌─────────────────┐
                    │      Loop       │
                    │  Register · Run │
                    │  Post · Stop    │
                    └────────┬────────┘
                             │
                          Poller
                    ┌────────┴────────┐
                    ▼                 ▼
           poller_linux.go    poller_darwin.go
               (epoll)            (kqueue)
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

Interest is a bitset: `Readable`, `Writable`, or both. The poller is **level-triggered**: a fd
keeps showing up as ready until the condition clears.

## Non-blocking and level-trigger
<!-- mode: read-only -->

Readiness without `O_NONBLOCK` is a deadlock waiting to happen.

```plaintext
  kernel     "fd 7 is readable"
       │
       ▼
  your loop  read(7)
       │
       │   packet already gone / checksum failed / …
       ▼
  blocking read  ──▶  parks the ONLY thread
       │
       ▼
  every other client waits forever
```

Two rules you own:

1. Drain until `EAGAIN`. That is how you know you are done for now.
2. Treat stale readiness as normal. The report is a hint, not a promise that the next `read`
   returns data.

`Register` must set non-blocking **before** the fd enters the poller.

```plaintext
  level-triggered (what we use)          edge-triggered (EPOLLET)

  data arrives ──────▶ ready             data arrives ──────▶ ready once
  you read some ─────▶ still ready       you read some ─────▶ silent
  read until EAGAIN ─▶ quiet             leftover bytes sit forever
                                         unless more data arrives
```

Level-triggered forgives partial reads. Still read until `EAGAIN`: one read per `Wait` throws
away throughput under pipelining.

**Writes — know the trap, defer the full fix.** A `write` can accept only part of your buffer.
The durable fix is an out buffer plus write-interest arming. This chapter does **not** require
arming `Writable` in the server. `Run` should still dispatch writable **before** readable so a
later chapter can plug in without reshuffling order. Production interest for Cinder V0.1 stays
Readable-first when the server arrives.

## What Register and Run do
<!-- mode: read-and-implement tasks:1.1,1.2 -->

Pollers, `Kind` / `Event`, `New`, `Modify`, `Deregister`, `Post`, `Stop`, `Close`, and the
tests are given. You own two bodies in `internal/eventloop/loop.go`.

### `TODO(1.1)` — `Register`

Set `O_NONBLOCK`, then `poller.Add` with the given interest. Non-blocking must happen
**before** the fd enters the interest set.

### `TODO(1.2)` — `Run`

```plaintext
              ┌──────────────────────────────────────┐
              │  LockOSThread()                      │
              │                                      │
        .────▶│  1. drain Post tasks                 │
        │     │                                      │
        │     │  2. poller.Wait(events, timeout)     │
        │     │         │                            │
        │     │    EINTR? ── yes ──▶ restart Wait    │
        │     │         │ no                         │
        │     │         ▼                            │
        │     │  3. for each event:                  │
        │     │       Writable? → OnWritable         │
        │     │       Readable? → OnReadable         │
        │     │       (handler err → next event)     │
        │     │                                      │
        │     │  4. stopped?                         │
        │     │       │ no ──────────────────────────'
        │     │      yes
        │     │       ▼
        │     │  drain tasks, return
        │     └──────────────────────────────────────┘
```

Pin the OS thread. Loop until `Stop`: drain `Post` tasks, `Wait`, retry `EINTR`, dispatch
**writable then readable**, ignore handler errors for that event, exit cleanly when stopped.
A small positive `timeoutMs` is how `Stop` and `Post` get noticed without a dedicated wakeup
fd.

Open the Tasks tab for both markers, implement them in `loop.go`, then continue.

## From main to PING
<!-- mode: read-only -->

`cmd/cinder/main.go` and `internal/server` are given. They prove your loop with a toy CRLF
protocol (`PING` / `ECHO` / `QUIT`). You do **not** fill in `main` or `server`.

```plaintext
  main
    │
    ├─ signal.Notify ──▶ Shutdown() ──▶ loop.Stop()
    │
    └─ server.Start()
           │
           ├─ net.Listen → dup listen fd
           ├─ eventloop.New(server)
           ├─ loop.Register(listenFD, Readable)   ← TODO(1.1)
           └─ loop.Run()                          ← TODO(1.2)
                  │
                  ▼
            OnReadable(listenFD)
                  │  Accept until EAGAIN
                  │  Register(clientFD, Readable)
                  ▼
            OnReadable(clientFD)
                  │  Read, buffer CRLF lines
                  ▼
            PING → PONG · ECHO → text · QUIT → BYE
```

CSP replaces this line protocol in the next chapter. When the loop is wrong, `make run` and
`nc` stay silent or hang.

```bash
make test
make race
make run
# then: printf 'PING\r\n' | nc 127.0.0.1 7379
```

There is no dict yet. Passing tests and a live `PING` means you own the scheduler Cinder
will hang every later chapter on.
