#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

dir=/home/learner/order-stack
project=order-stack

wait_docker

cfg() { in_box "docker compose --project-directory $dir -f $dir/compose.yaml config --format json | jq -r '$1'"; }
cfg .name >/dev/null 2>&1 || fail "compose.yaml is not valid (cd ~/order-stack && docker compose config)"
[[ "$(cfg '.services["order-processor"].depends_on.migrate.condition // ""')" == service_completed_successfully ]] \
  || fail "order-processor must start only after migrate has finished successfully (condition: service_completed_successfully)"
[[ "$(cfg '.services["notification-service"].depends_on["order-processor"].condition // ""')" == service_healthy ]] \
  || fail "notification-service must start only once order-processor is healthy (condition: service_healthy)"
[[ "$(cfg '.services["order-processor"].image')" == devsetu/slow-order-processor:1.0 ]] \
  || fail "keep order-processor on devsetu/slow-order-processor:1.0 (the build that boots in 25 s)"
ok "dependencies declared"

# Start from nothing, exactly as the next person would.
in_box "cd $dir && docker compose down >/dev/null 2>&1; true"
in_box "cd $dir && timeout 150 docker compose up -d --wait --wait-timeout 120 >/tmp/dl-grade-up.log 2>&1" \
  || fail "docker compose up -d --wait does not bring the stack up healthy: $(in_box 'tail -n 3 /tmp/dl-grade-up.log' | tr '\n' ' ')"
ok "docker compose up --wait succeeds from scratch"

mg="$(compose_container "$project" migrate)"
op="$(compose_container "$project" order-processor)"
ns="$(compose_container "$project" notification-service)"
[[ "$(inspect "$mg" '{{.State.Status}} {{.State.ExitCode}}')" == "exited 0" ]] || fail "migrate should run once and exit 0"
[[ "$(container_health "$op")" == healthy ]] || fail "order-processor is not healthy"
[[ "$(container_state "$ns")" == running ]] || fail "notification-service is not running"
op_start="$(inspect "$op" '{{.State.StartedAt}}')"
mg_end="$(inspect "$mg" '{{.State.FinishedAt}}')"
ns_start="$(inspect "$ns" '{{.State.StartedAt}}')"
[[ "$op_start" > "$mg_end" ]] || fail "order-processor started before migrate finished"
ok "migrate finished, then order-processor started"

# order-processor can't be healthy before its 25 s boot, so a dependent that waited starts well after it.
gap=$(( $(in_box "date -d '$ns_start' +%s") - $(in_box "date -d '$op_start' +%s") ))
(( gap >= 20 )) || fail "notification-service started ${gap}s after order-processor, before it could be healthy"
[[ "$(dk exec "$op" cat /schema/version 2>/dev/null)" == 7 ]] || fail "order-processor can't see the schema version written by migrate"
ok "notification-service started after order-processor turned healthy"

pass "the stack starts in the right order, every time"
