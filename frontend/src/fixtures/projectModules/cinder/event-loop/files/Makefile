.PHONY: test race run build

test:
	go test ./internal/eventloop/

race:
	go test -race ./internal/eventloop/

build:
	go build -o bin/cinder ./cmd/cinder/

run: build
	./bin/cinder
