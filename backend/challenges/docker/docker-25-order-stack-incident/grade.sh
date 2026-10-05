#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

dir=/home/learner/order-stack
project=order-stack
min="$(in_box 'cat /root/.lab/min')"

wait_docker

need_answer port-thief "the container that was holding port 8080"
[[ "$(answer port-thief)" == debug-nginx ]] || fail "~/answers/port-thief is not the container that held port 8080 (docker ps)"
! container_exists debug-nginx || fail "debug-nginx is still on the box; remove it (it has --restart always)"
ok "port 8080 freed"

cfg() { in_box "docker compose --project-directory $dir -f $dir/compose.yaml config --format json | jq -r '$1'"; }
cfg .name >/dev/null 2>&1 || fail "compose.yaml is not valid (cd ~/order-stack && docker compose config)"
[[ "$(cfg '.services["payment-handler"].image')" == devsetu/payment-handler:v1.1 ]] \
  || fail "payment-handler must run the version production runs (see INCIDENT.txt)"
[[ "$(cfg '.services["order-processor"].depends_on["payment-handler"].condition // ""')" == service_healthy \
  && "$(cfg '.services["order-processor"].depends_on["notification-service"].condition // ""')" == service_healthy ]] \
  || fail "keep order-processor waiting for healthy payment-handler and notification-service"
ok "compose.yaml"

# Recreate from the file, as the next deploy would.
in_box "cd $dir && docker compose down >/dev/null 2>&1; true"
in_box "cd $dir && timeout 150 docker compose up -d --wait --wait-timeout 120 >/tmp/dl-grade-up.log 2>&1" \
  || fail "docker compose up -d --wait fails: $(in_box 'tail -n 3 /tmp/dl-grade-up.log' | tr '\n' ' ')"
ok "the stack comes up healthy from compose.yaml"

op="$(compose_container "$project" order-processor)"
ph="$(compose_container "$project" payment-handler)"
ns="$(compose_container "$project" notification-service)"
[[ "$(container_health "$ph")" == healthy ]] || fail "payment-handler is not healthy"
[[ "$(container_health "$ns")" == healthy ]] || fail "notification-service is not healthy"
[[ "$(container_state "$op")" == running ]] || fail "order-processor is not running"
get() {
  dk exec "$op" python -c "import urllib.request; print(urllib.request.urlopen('$1', timeout=3).read().decode())" 2>/dev/null || true
}
[[ "$(get http://payment-handler:8000/health)" == *'"status":"ok"'* ]] || fail "order-processor can't reach http://payment-handler:8000"
[[ "$(get http://notification-service:8080/health)" == *'"status":"ok"'* ]] || fail "order-processor can't reach http://notification-service:8080"
ok "order-processor reaches payment-handler and notification-service"

[[ "$(box_json http://127.0.0.1:8080/health .version)" == v1.2 ]] || fail "http://127.0.0.1:8080 isn't order-processor"
low="$(http_code POST http://127.0.0.1:8080/orders "{\"items\":[\"chai\"],\"total\":$((min - 1))}")"
high="$(http_code POST http://127.0.0.1:8080/orders "{\"items\":[\"chai\"],\"total\":$((min + 5))}")"
[[ "$low" == 400 && "$high" == 201 ]] || fail "orders on 8080 should follow MIN_ORDER_VALUE=$min (got $low and $high)"
ok "customers can order again"

pass "INC-2041 resolved: the order stack is back"
