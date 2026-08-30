BIN  := bin/cinder
PORT ?= 7379

.PHONY: build run test race loop vet smoke clean

build:
	go build -o $(BIN) ./cmd/cinder

run: build
	CINDER_ADDR=:$(PORT) $(BIN)

test:
	go test ./...

# The interesting one for this module: if command execution ever leaves the
# loop goroutine, the race detector is what tells you.
race:
	go test -race ./...

# Loop-level tests only. They use a socketpair, so they pass before the server
# TODOs are done.
loop:
	go test ./internal/evloop/

vet:
	go vet ./...

smoke: build
	PORT=$(PORT) ./scripts/smoke.sh

clean:
	rm -rf bin
