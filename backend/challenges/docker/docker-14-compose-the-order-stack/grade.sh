#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

dir=/home/learner/order-stack
project=order-stack
net="${project}_orders-net"

wait_docker

box_ok "test -f $dir/compose.yaml" || fail "$dir/compose.yaml does not exist"
cfg() {
  in_box "docker compose --project-directory $dir -f $dir/compose.yaml config --format json | jq -r '$1'"
}
cfg '.name' >/dev/null 2>&1 || fail "compose.yaml is not valid (cd ~/order-stack && docker compose config)"
box_ok "grep -Eq '^[[:space:]]*env_file:' $dir/compose.yaml" \
  || fail "load order-processor's settings with env_file: order-processor.env (don't copy them into compose.yaml)"
[[ "$(cfg '.services["order-processor"].depends_on["payment-handler"].condition // ""')" == service_healthy ]] \
  || fail "order-processor must wait for a healthy payment-handler (depends_on: payment-handler: condition: service_healthy)"
ok "compose.yaml"

op="$(compose_container "$project" order-processor)"
ph="$(compose_container "$project" payment-handler)"
[[ -n "$op" && -n "$ph" ]] \
  || fail "no containers for project $project (run docker compose up -d in ~/order-stack, with services order-processor and payment-handler)"
for svc in order-processor payment-handler; do
  id="$(compose_container "$project" "$svc")"
  [[ "$(container_state "$id")" == running ]] || fail "$svc is not running (docker compose ps; docker compose logs $svc)"
  [[ "$(inspect "$id" '{{.HostConfig.RestartPolicy.Name}}')" == unless-stopped ]] \
    || fail "$svc must have restart: unless-stopped"
  inspect "$id" '{{range $n, $_ := .NetworkSettings.Networks}}{{println $n}}{{end}}' | grep -qx "$net" \
    || fail "$svc must be on the orders-net network"
done
[[ "$(inspect "$op" '{{.Config.Image}}')" == devsetu/order-processor:v1.2 ]] \
  || fail "order-processor must run devsetu/order-processor:v1.2"
[[ "$(inspect "$ph" '{{.Config.Image}}')" == devsetu/payment-handler:v1.1 ]] \
  || fail "payment-handler must run devsetu/payment-handler:v1.1"
ok "both services running, restart unless-stopped, on orders-net"

[[ "$(published_port "$op" 8000)" == 8080 ]] || fail "publish order-processor's port 8000 on host port 8080"
[[ -z "$(dk port "$ph" 2>/dev/null)" ]] \
  || fail "payment-handler must not publish any ports: only order-processor talks to it, over orders-net"
ok "only order-processor is published"

wait_health "$ph" healthy 40 \
  || fail "payment-handler has no passing healthcheck (python:3.12-slim images have no curl; probe /health with python)"
ok "payment-handler is healthy"

min="$(in_box "sed -n 's/^MIN_ORDER_VALUE=//p' $dir/order-processor.env")"
[[ "$(container_env "$op" MIN_ORDER_VALUE)" == "$min" ]] \
  || fail "order-processor doesn't have MIN_ORDER_VALUE=$min from order-processor.env"
reply="$(dk exec "$op" python -c "import urllib.request; print(urllib.request.urlopen('http://payment-handler:8000/health', timeout=3).read().decode())" 2>/dev/null || true)"
[[ "$reply" == *'"status":"ok"'* ]] || fail "order-processor cannot reach http://payment-handler:8000/health by name"
ok "order-processor reaches payment-handler by name"

low="$(http_code POST http://127.0.0.1:8080/orders "{\"items\":[\"chai\"],\"total\":$((min - 1))}")"
high="$(http_code POST http://127.0.0.1:8080/orders "{\"items\":[\"chai\"],\"total\":$((min + 5))}")"
[[ "$low" == 400 && "$high" == 201 ]] \
  || fail "orders on 8080 should be rejected below $min and accepted above (got $low and $high)"
ok "orders follow MIN_ORDER_VALUE=$min"

pass "the order stack comes up with one command"
