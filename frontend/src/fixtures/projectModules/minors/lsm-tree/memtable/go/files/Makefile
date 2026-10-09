.PHONY: test race bench run vet

test:
	go test ./...

race:
	go test -race ./...

bench:
	go test -run '^$$' -bench . ./internal/memtable

run:
	go run ./cmd/lsmkv

vet:
	go vet ./...
