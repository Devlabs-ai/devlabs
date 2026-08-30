# The program that waits

Most programs run and finish. This one refuses to finish.

Think of a shop with a published phone number. The shop does not know who will
call, or when, or how many people will call at once. Its whole job is to be
reachable at a known number: pick up when the phone rings, listen to what the
caller says, say something back, hang up, and then wait again. A shop that is
not waiting is a shop you cannot reach.

Every piece of software you talk to over a network is that shop. When a page
loads, your browser called a program that was already sitting there waiting.
`git push` calls a program waiting on a port. Your bank app, your database,
`ssh`, the Docker daemon, the dev server on `localhost:3000` your teammate is
poking at — all of them are processes that published an address and then
waited.

Two details from the phone shop matter far more than they look.

- **One published number, many callers at once.** The number is not used up by
  the first person who calls. Someone answers, hands that caller a private
  line, and goes straight back to listening for the next ring.
- **You cannot answer half a sentence.** If a caller says "I would like…" and
  pauses, you wait. You reply when the sentence is finished — not the moment
  sound arrives.

Those two ideas are the entire build. We are writing a process that waits on a
port, holds many conversations at once, and answers only complete sentences.
Ours has a three-word vocabulary: `PING`, `ECHO`, `QUIT`.

## Publishing a number, answering a call

The operating system owns the network, so your program asks the kernel for all
of this. In any language, on any Unix, it is four calls and a loop.

**Publish the number.** `socket()` hands you a file descriptor — a number,
nothing more. `bind()` attaches that number to a local address such as
`0.0.0.0:7400`. `listen()` marks it passive and creates the **backlog**: a
queue where the kernel parks callers whose connection is already established
but whom your code has not answered yet.

**Answer a call.** `accept()` takes one caller out of that queue and returns a
*new* descriptor. This is where first servers go wrong, so make it concrete —
you now hold two descriptors with completely different jobs.

```plaintext
     one published address          one line per caller
     ─────────────────────          ───────────────────
Client A ──┐
Client B ──┼──▶  :7400  ──accept()──▶  fd 7  ⇄  Client A
Client C ──┘   (listener)              fd 8  ⇄  Client B
                                       fd 9  ⇄  Client C
```

The listener is the receptionist. It never carries a conversation. Each
accepted descriptor *is* one conversation, and it is the only thing you read
and write.

One listener can hold tens of thousands of these at the same time, because a
connection is identified by the whole four-tuple:

```plaintext
(source IP, source port, destination IP, destination port)
```

Your half of that tuple repeats for every caller; theirs does not. So the
ceiling is file descriptors, not ports. Run out of descriptors and `accept()`
starts failing with `EMFILE`, which from the outside is indistinguishable from
a dead server.

The backlog is worth respecting for the same reason. If your accept loop
stalls, the queue fills, and new callers are refused or time out — a slow
accept loop looks exactly like downtime.

## TCP hands you a stream, not sentences

TCP promises that bytes arrive in order, with no gaps and no duplicates. It
promises nothing about how they are grouped. It is a stream, not a queue of
envelopes.

```plaintext
client writes:  [ PING\r\n ]        [ ECHO hi\r\n ]
                     │                     │
wire:           . . . bytes, in order, no envelopes . . .
                     │                     │
your reads:     [PING\r] [\nECHO] [ hi\r\n]      3 reads
framing:        split on '\n'  ──▶  "PING" │ "ECHO hi"   2 requests
```

Both groupings above are correct TCP. The network is allowed to do that; your
code is not allowed to be surprised by it. So one `read` is never one request.

You need **framing** — a rule for finding message boundaries in a stream. Two
rules cover almost everything in practice:

- **Delimiter framing.** Read until a sentinel, usually `\r\n`. Simple, and
  what we use here. It comes with a catch: you must cap the line length, or a
  caller who never sends a newline grows your buffer until the process dies.
  That is a one-line denial of service, not a hypothetical.
- **Length-prefix framing.** Read a small header that says how many bytes
  follow, then read exactly that many. HTTP/2 and most binary RPC work this
  way. More moving parts, no sentinel to collide with.

When the cap trips, the stream is no longer framed: you cannot know where the
next request begins. The only honest response is to reply with an error and
hang up.

## Many callers, and hanging up properly

Each conversation is its own small loop: read a sentence, work out what it
means, reply. Many conversations run at the same time, independently.

Shutting all of that down is its own problem, and it is the part that gets
skipped. Your code is blocked in `accept()`, waiting for a ring that may never
come, so "stop" cannot be a flag you check at the top of the loop. You close
the listener to unblock it. Then you close the live conversations, which is
what unblocks *their* reads. Then you wait for those loops to actually return,
so you never exit halfway through writing a reply.

```plaintext
setup   socket ── bind(:7400) ── listen(backlog)
                                      │
kernel  SYN ── SYN-ACK ── ACK         │  kernel's job; the caller
                                      │  waits in the backlog
                                      │  until you accept
serve   accept() ─▶ conn fd ─▶ read ─ handle ─ write ─ flush
                                ▲                          │
                                └──────── repeat ──────────┘
stop    close(listener) ── close(conns) ── wait(handlers)
```

Two quieter failures live in the same area.

A caller whose machine disappears — lid closed, cable pulled, NAT entry
expired — never hangs up and never sends anything again. Without a deadline on
each read, that descriptor is yours forever. An idle timeout is not
politeness; it is how you get your file descriptors back.

And restarting too quickly can fail with "address already in use" even though
the old process is gone. The previous socket is in `TIME_WAIT`, with TCP
holding the four-tuple reserved so a delayed packet cannot land on a fresh
connection. `SO_REUSEADDR` is what lets you bind over it.

## The same steps, in Go

Go does not change any of the picture above. It names it. The `net` package is
a thin, honest layer over those syscalls.

| What it is | Go call | Where in this repo |
| --- | --- | --- |
| `socket` + `bind` + `listen` | `net.Listen("tcp", addr)` | `Server.Listen` — **TODO(1.1)** |
| Answer a call | `ln.Accept()` | `Server.acceptLoop` — **TODO(1.2)** |
| A private line per caller | `go c.serve()` | same block |
| Wait for a whole sentence | `bufio.Reader.ReadSlice('\n')` | `conn.readLine` (given) |
| Cap the sentence | reader sized to `MaxLineBytes` | `newConn` (given) |
| Sentence to request | `ParseLine` | `line.go` (given) |
| Dead caller still holding a line | `SetReadDeadline` each read | `conn.serve` — **TODO(1.3)** |
| Reply, actually on the wire | `bufio.Writer` then `Flush` | `conn.serve` — **TODO(1.3)** |
| Stop answering | `ln.Close()` unblocks `Accept` | `Server.Close` — **TODO(1.4)** |
| Do not exit mid-reply | `wg.Wait()` | `Server.Close` — **TODO(1.4)** |
| Ctrl-C | `signal.NotifyContext` | `main.go` (given) |

The accept loop is the middle row of that last diagram, written out:

```go
for {
    nc, err := ln.Accept()   // one caller off the backlog
    if err != nil {
        return err           // unless we asked for this — then nil
    }
    go handle(nc)            // a private line, its own goroutine
}
```

A blocking `Read` inside `handle` is the right call in Go. A goroutine costs
kilobytes rather than a thread, and the runtime quietly parks blocked ones on
epoll or kqueue, so you get one readiness loop in the kernel without writing
one. You write the conversation as a straight line.

Two things bite anyway:

- **Flush every reply.** A reply sitting in a buffer is a caller waiting on
  silence. Request/response protocols flush each time round; there is no
  later.
- **A closed write side is not a hangup.** `printf 'PING\r\n' | nc` sends the
  line, shuts down its write half, and waits. Answer what already arrived
  before you close.

## Three words, and the four holes

The vocabulary is one line in, one line out, CRLF terminated. A bare `\n` is
accepted too, so telnet and `printf | nc` both work.

| You send | You get |
| --- | --- |
| `PING` | `PONG` |
| `ECHO hello` | `hello` |
| `QUIT` | `BYE`, then the line closes |
| anything else | `ERR unknown command "FOO"` |

Blank lines are nothing at all. An unknown verb is an error reply, not a
disconnect. `QUIT` is the only request that ends a conversation on purpose.

The repo on the right is one Go package. Config, logging, the parser, the
command table and the tests are written. Four blocks panic, and they are
exactly the four things this article described:

1. **`TODO(1.1)`** — `Server.Listen` in `server.go`. Publish the number: bind
   the address and keep the listener.
2. **`TODO(1.2)`** — `Server.acceptLoop` in `server.go`. Answer calls forever,
   one goroutine each, and treat a shutdown-triggered error as success.
3. **`TODO(1.3)`** — `conn.serve` in `conn.go`. The conversation: deadline,
   read a framed line, parse, handle, write, flush.
4. **`TODO(1.4)`** — `Server.Close` in `server.go`. Stop answering, close live
   lines, wait for every handler to return.

The tests dial a real port on an ephemeral address, and `make smoke` drives the
server through `nc` the way a person would:

```shell
make run
# in another terminal
printf 'PING\r\nECHO hi\r\nQUIT\r\n' | nc 127.0.0.1 7400
```

```plaintext
PONG
hi
BYE
```

When that transcript comes back, the shop is open — the same machine
everything else you use is built on, with three words instead of a thousand.
