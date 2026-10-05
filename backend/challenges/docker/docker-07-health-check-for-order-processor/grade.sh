#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"
trap grade_cleanup EXIT

image=quickbyte/order-processor:1.4
run=op-14

wait_docker

image_exists "$image" || fail "no image $image (docker build -t $image ~/order-processor)"
[[ "$(container_env "$image" APP_VERSION)" == v1.4 ]] || fail "set ENV APP_VERSION=v1.4"
ok "image $image built"

label() { inspect "$image" "{{index .Config.Labels \"$1\"}}"; }
[[ "$(label org.opencontainers.image.title)" == order-processor ]] \
  || fail "label org.opencontainers.image.title must be order-processor"
[[ "$(label org.opencontainers.image.version)" == 1.4 ]] || fail "label org.opencontainers.image.version must be 1.4"
[[ "$(label com.quickbyte.team)" == orders ]] || fail "label com.quickbyte.team must be orders"
ok "labels"

hc() { in_box "docker image inspect -f '{{json .Config.Healthcheck}}' $image | jq -r '$1'"; }
test_cmd="$(hc '(.Test // []) | join(" ")')"
[[ -n "$test_cmd" && "$test_cmd" != NONE* ]] || fail "$image has no HEALTHCHECK"
[[ "$test_cmd" == *8000/health* ]] || fail "the HEALTHCHECK must probe the app's own endpoint, http://127.0.0.1:8000/health"
interval="$(hc '.Interval // 0')"
timeout="$(hc '.Timeout // 0')"
retries="$(hc '.Retries // 0')"
(( interval > 0 && interval <= 30000000000 )) || fail "set --interval explicitly, 30s or less (the default checks only every 30 s)"
(( timeout > 0 && timeout <= 5000000000 )) || fail "set --timeout explicitly, 5s or less"
(( retries >= 2 && retries <= 5 )) || fail "set --retries between 2 and 5: one slow answer shouldn't mark it unhealthy"
ok "HEALTHCHECK: $test_cmd"

# Same probe, faster timing: healthy against the real app, unhealthy when nothing listens.
dk_ok run -d --name dl-grade-hc-ok --health-interval 2s --health-start-period 30s "$image" \
  || fail "a container from $image did not start"
wait_health dl-grade-hc-ok healthy 40 \
  || fail "the HEALTHCHECK never passed against a working app (python:3.12-slim has no curl or wget; probe with python)"
dk_ok run -d --name dl-grade-hc-bad --health-interval 2s --health-retries 2 --health-start-period 0s \
  --entrypoint sleep "$image" infinity
wait_health dl-grade-hc-bad unhealthy 40 \
  || fail "the HEALTHCHECK still passes when nothing listens on port 8000; it must fail when the app is down"
ok "healthy when the app answers, unhealthy when it doesn't"

container_exists "$run" || fail "no container named $run"
[[ "$(inspect "$run" '{{.Image}}')" == "$(inspect "$image" '{{.Id}}')" ]] \
  || fail "$run is not running the latest build of $image (remove and run it again)"
[[ "$(published_port "$run" 8000)" == 8082 ]] || fail "publish $run's port 8000 on host port 8082"
wait_health "$run" healthy 45 || fail "$run is not healthy (docker ps; docker inspect --format '{{json .State.Health}}' $run)"
ok "$run is healthy"

pass "order-processor reports its own health"
