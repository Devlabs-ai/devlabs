#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

dir=/home/learner/order-stack
project=order-stack

wait_docker

for f in compose.yaml compose.override.yaml compose.prod.yaml; do
  box_ok "test -f $dir/$f" || fail "$dir/$f does not exist"
done

# conf <compose args> <jq filter> — the merged config for one combination of files/profiles.
conf() { in_box "cd $dir && docker compose $1 config --format json 2>/dev/null | jq -r '$2'"; }
op='.services["order-processor"]'

[[ "$(conf '-f compose.yaml' "$op.environment.LOG_LEVEL")" == INFO ]] \
  || fail "compose.yaml on its own must still have LOG_LEVEL=INFO; put environment differences in the other files"
[[ "$(conf '-f compose.yaml' "$op.ports[0].published // \"\"")" == 8080 ]] \
  || fail "keep order-processor's 8080:8000 in compose.yaml"
ok "base compose.yaml"

[[ "$(conf '' "$op.environment.LOG_LEVEL")" == DEBUG ]] \
  || fail "docker compose (base + compose.override.yaml) must give order-processor LOG_LEVEL=DEBUG"
[[ "$(conf '' "$op.environment.MIN_ORDER_VALUE")" == 10 ]] || fail "the override should change LOG_LEVEL only, not drop MIN_ORDER_VALUE"
ok "dev: compose.override.yaml is picked up automatically"

prod='-f compose.yaml -f compose.prod.yaml'
[[ "$(conf "$prod" "$op.environment.LOG_LEVEL")" == WARNING ]] || fail "with compose.prod.yaml, LOG_LEVEL must be WARNING"
for svc in order-processor payment-handler; do
  [[ "$(conf "$prod" ".services[\"$svc\"].restart")" == always ]] || fail "with compose.prod.yaml, $svc must have restart: always"
done
[[ "$(conf "$prod" "$op.ports // [] | length")" == 0 ]] \
  || fail "with compose.prod.yaml, order-processor must publish no ports (prod traffic comes through the load balancer). Lists merge: use ports: !reset []"
ok "prod: WARNING, restart always, no published ports"

[[ "$(conf '' '.services | keys | join(" ")')" != *toolbox* ]] \
  || fail "toolbox must not be part of the stack by default; put it in the debug profile"
[[ "$(conf '--profile debug' '.services.toolbox.image // ""')" == alpine:3.20 ]] \
  || fail "define a toolbox service (image alpine:3.20) in compose.yaml under profiles: [debug]"
[[ "$(conf '--profile debug' '.services.toolbox.profiles // [] | join(" ")')" == debug ]] || fail "toolbox must be in profile debug"
ok "toolbox only with --profile debug"

c="$(compose_container "$project" order-processor)"
[[ -n "$c" && "$(container_state "$c")" == running ]] || fail "order-processor is not running (docker compose up -d in ~/order-stack)"
[[ "$(container_env "$c" LOG_LEVEL)" == DEBUG ]] || fail "the running order-processor should be the dev variant, LOG_LEVEL=DEBUG (docker compose up -d)"
[[ "$(published_port "$c" 8000)" == 8080 ]] || fail "the running order-processor should publish 8080"
[[ -z "$(compose_container "$project" toolbox)" ]] || fail "toolbox is running; start the stack without --profile debug"
ok "dev stack running"

pass "one compose.yaml, with dev and prod variations layered on top"
