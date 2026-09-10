# Cinder — chapter 1: the event loop

Fill `TODO(1.1)` and `TODO(1.2)` in `internal/eventloop/loop.go`. Pollers are
given. `cmd/cinder` and `internal/server` are author-owned: a basic TCP front
end that accepts connections on the loop and speaks a toy line protocol
(`PING` / `ECHO` / `QUIT`) until CSP arrives later.

```bash
make test
make race
make run
# another terminal:
printf 'PING\r\n' | nc 127.0.0.1 7379
```

Override the listen address with `CINDER_ADDR` (default `127.0.0.1:7379`).
