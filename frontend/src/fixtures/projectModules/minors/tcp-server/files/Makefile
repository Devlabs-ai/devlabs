BIN  := bin/linesrv
PORT ?= 7400

.PHONY: build run test smoke vet clean

build:
	go build -o $(BIN) .

run: build
	LINESRV_ADDR=:$(PORT) $(BIN)

test:
	go test .

vet:
	go vet .

smoke: build
	PORT=$(PORT) ./smoke.sh

clean:
	rm -rf bin
