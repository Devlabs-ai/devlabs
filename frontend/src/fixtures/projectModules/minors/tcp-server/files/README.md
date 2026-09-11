# LineSrv

A line-oriented TCP server in Go. Bind a listener, accept clients, and serve
PING / ECHO / QUIT with one goroutine per connection.

Everything lives in one package.

```
main.go          process entrypoint: config, signals, run
config.go        startup knobs, resolved from env once
logx.go          tiny leveled logger
line.go          request parsing + reply formatting (given)
server.go        listener + accept loop      <- TODO 1.1, 1.2, 1.4
conn.go          per-connection read loop    <- TODO 1.3
server_test.go   acceptance tests over a real socket
smoke.sh         end-to-end check through nc
```

## Your work

Four blocks are marked `TODO(1.x)` and currently panic. Everything else is
written for you.

| Task | Where | What |
| --- | --- | --- |
| 1.1 | `server.go` `Listen` | Bind the address, keep the listener |
| 1.2 | `server.go` `acceptLoop` | Accept forever, one goroutine per connection |
| 1.3 | `conn.go` `serve` | Read framed lines, handle, reply, flush |
| 1.4 | `server.go` `Close` | Graceful shutdown |

## Running

```
make run      # starts on :7400 (override with PORT=7401)
make test     # go test .
make smoke    # drives the server with nc
```

## Protocol

One request per line, CRLF terminated (bare LF accepted).

```
PING          -> PONG
ECHO hello    -> hello
QUIT          -> BYE, then close
FOO           -> ERR unknown command "FOO"
```
