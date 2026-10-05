#!/usr/bin/env bash
# ~/reconciliation: the Go rewrite of the nightly reconciliation job (stdlib only, so it
# builds offline) with a per-session build ID, and a single-stage Dockerfile that ships
# the whole Go toolchain.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

build="R-$(printf '%04X%04X' $RANDOM $RANDOM)"

wait_docker
prepull golang:1.23-alpine alpine:3.20

box_script <<EOF
rm -rf /home/learner/reconciliation
install -d -o learner -g learner /home/learner/reconciliation
cd /home/learner/reconciliation
cat > go.mod <<'GOMOD'
module quickbyte.io/reconciliation

go 1.23
GOMOD
cat > main.go <<'GO'
// Nightly reconciliation: matches captured payments against created orders.
package main

import (
	"flag"
	"fmt"
	"os"
)

const buildID = "$build"

func main() {
	mode := flag.String("mode", "full", "full or incremental")
	flag.Parse()
	if *mode != "full" && *mode != "incremental" {
		fmt.Fprintf(os.Stderr, "unknown mode %q\n", *mode)
		os.Exit(2)
	}
	fmt.Printf("reconciliation build=%s mode=%s\n", buildID, *mode)
	fmt.Println("matched 1204 payments to 1204 orders, 0 mismatches")
}
GO
cat > Dockerfile <<'DOCKERFILE'
FROM golang:1.23-alpine

WORKDIR /src
COPY go.mod main.go ./
RUN go build -o /usr/local/bin/reconciliation .

ENTRYPOINT ["/usr/local/bin/reconciliation"]
CMD ["--mode=full"]
DOCKERFILE
chown -R learner:learner /home/learner/reconciliation
install -d -m 700 /root/.lab
echo "$build" > /root/.lab/build-id
EOF
fresh_answers
ok "~/reconciliation ready"
