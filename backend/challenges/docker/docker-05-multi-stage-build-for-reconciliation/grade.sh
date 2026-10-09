#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"
trap 'in_box "docker rm -f dl-grade-export >/dev/null 2>&1; true" >/dev/null 2>&1 || true' EXIT

src=/home/learner/reconciliation
image=quickbyte/order-reconciliation:2.0
max_mb=20

wait_docker

froms="$(in_box "grep -Eic '^[[:space:]]*FROM[[:space:]]' $src/Dockerfile" || true)"
(( froms >= 2 )) || fail "the Dockerfile needs two stages: one FROM to build, one FROM to run"
box_ok "grep -Eiq '^[[:space:]]*COPY[[:space:]]+--from=' $src/Dockerfile" \
  || fail "copy the built binary into the final stage with COPY --from=<build stage>"
ok "multi-stage Dockerfile"

image_exists "$image" || fail "no image $image (docker build -t $image ~/reconciliation)"
size=$(( $(inspect "$image" '{{.Size}}') / 1024 / 1024 ))
(( size <= max_mb )) || fail "$image is ${size} MB; it must be ${max_mb} MB or less (the final stage shouldn't contain Go)"
ok "$image is ${size} MB"

dk_ok create --name dl-grade-export "$image" || fail "could not create a container from $image"
files="$(in_box 'docker export dl-grade-export | tar -t')"
grep -q '^usr/local/go/' <<<"$files" && fail "$image still contains the Go toolchain (/usr/local/go)"
grep -Eq '(^|/)main\.go$' <<<"$files" && fail "$image still contains the source code (main.go)"
ok "no toolchain or source in the image"

build="$(in_box 'cat /root/.lab/build-id')"
out="$(dk run --rm "$image" 2>&1)" || fail "docker run --rm $image fails: $out"
[[ "$out" == *"build=$build mode=full"* ]] \
  || fail "docker run --rm $image should print 'build=$build mode=full' (built from ~/reconciliation, default mode full); got: $out"
out="$(dk run --rm "$image" --mode=incremental 2>&1)" || true
[[ "$out" == *"mode=incremental"* ]] \
  || fail "arguments after the image must reach the binary (ENTRYPOINT the binary, CMD the default --mode=full)"
ok "runs the reconciliation binary, default mode full"

pass "reconciliation ships as a ${size} MB image without the toolchain"
