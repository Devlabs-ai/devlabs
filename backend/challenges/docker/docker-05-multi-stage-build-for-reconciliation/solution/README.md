# Solution — Multi-Stage Build for Reconciliation

To **build** a Go program you need the Go toolchain (hundreds of MB). To **run** it you need one static binary. A multi-stage Dockerfile uses a big image to build and a tiny one to ship, and copies only the result across.

Docs: [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)

## See the problem

```bash
cd ~/reconciliation
docker build -t reconciliation:fat .
docker images reconciliation:fat       # ~250 MB to run a 2 MB program
docker run --rm --entrypoint go reconciliation:fat version     # the whole toolchain ships too
```

Every extra MB is pulled on every node, and every extra tool (compiler, shell, package manager) is something an attacker can use.

## Two stages

```dockerfile
# ---- build ----
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/reconciliation .

# ---- run ----
FROM alpine:3.20
COPY --from=build /out/reconciliation /usr/local/bin/reconciliation
USER 65534
ENTRYPOINT ["/usr/local/bin/reconciliation"]
CMD ["--mode=full"]
```

- `AS build` names the first stage; `COPY --from=build` copies a file out of it. Nothing else from that stage reaches the final image.
- `CGO_ENABLED=0` makes a fully static binary that needs no C library, so it runs on Alpine (or even `FROM scratch`, an empty image).
- `-ldflags="-s -w"` strips debug symbols: smaller binary.
- **ENTRYPOINT + CMD**: the entrypoint is the program; CMD supplies default arguments. `docker run IMAGE --mode=incremental` replaces only the CMD part.

## Build and run

```bash
docker build -t quickbyte/order-reconciliation:2.0 ~/reconciliation
docker images quickbyte/order-reconciliation      # a few MB
docker run --rm quickbyte/order-reconciliation:2.0
# reconciliation build=R-.... mode=full
docker run --rm quickbyte/order-reconciliation:2.0 --mode=incremental
```

## Going further: FROM scratch

```dockerfile
FROM scratch
COPY --from=build /out/reconciliation /reconciliation
ENTRYPOINT ["/reconciliation"]
CMD ["--mode=full"]
```

`scratch` has no shell and no files at all: the smallest and most locked-down option, but you can't `docker exec ... sh` into it to debug. Alpine is a common middle ground.

Then **Submit**.
