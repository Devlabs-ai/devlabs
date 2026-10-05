#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker

need_answer docker-version "the Docker Engine version, e.g. 29.1.0"
server="$(dk version -f '{{.Server.Version}}')"
[[ "$(answer docker-version)" == "$server" ]] \
  || fail "~/answers/docker-version should be the Server (Engine) version from docker version, not the Client's"
ok "engine version"

[[ "$(container_state scratchpad)" == running ]] \
  || fail "no running container named scratchpad (docker run -d --name scratchpad ...)"
[[ "$(inspect scratchpad '{{.Config.Image}}')" == alpine:3.20 ]] || fail "scratchpad must run the alpine:3.20 image"
[[ "$(inspect scratchpad '{{join .Config.Cmd " "}}')" == "sleep infinity" ]] \
  || fail "scratchpad's command must be: sleep infinity"
ok "scratchpad is running"

container_exists hello-once \
  || fail "no container named hello-once (don't use --rm: the grader reads it after it exits)"
[[ "$(inspect hello-once '{{.Config.Image}}')" == alpine:3.20 ]] || fail "hello-once must run the alpine:3.20 image"
state="$(container_state hello-once)"
[[ "$state" == exited ]] || fail "hello-once should have finished (state exited); it is $state"
code="$(inspect hello-once '{{.State.ExitCode}}')"
[[ "$code" == 0 ]] || fail "hello-once exited with code $code; expected 0"
logs="$(dk logs hello-once 2>&1)"
grep -qx 'order box ready' <<<"$logs" || fail "hello-once should print exactly: order box ready"
ok "hello-once ran and exited"

need_answer batch-id "the BATCH-ID printed by the old-batch container"
[[ "$(answer batch-id)" == "$(in_box 'cat /root/.lab/batch-id')" ]] \
  || fail "~/answers/batch-id doesn't match the BATCH-ID in old-batch's logs (docker logs old-batch)"
ok "batch ID"
if container_exists old-batch; then
  fail "old-batch still exists: remove it once you've read its logs (docker rm old-batch)"
fi
ok "old-batch removed"

pass "you can run, inspect and clean up containers"
