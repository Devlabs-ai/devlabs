#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

net=quickbyte-net

wait_docker

[[ "$(inspect_jq "$net" '.Driver')" == bridge ]] || fail "no bridge network named $net (docker network create $net)"
ok "network $net"

networks() { inspect "$1" '{{range $n, $_ := .NetworkSettings.Networks}}{{println $n}}{{end}}' | grep -v '^$' | sort | tr '\n' ' '; }
for c in order-processor payment-handler notification-service; do
  container_exists "$c" || fail "no container named $c"
  [[ "$(container_state "$c")" == running ]] || fail "$c is not running"
done
[[ "$(inspect notification-service '{{.Config.Image}}')" == devsetu/notification-service:v1.1 ]] \
  || fail "notification-service must run devsetu/notification-service:v1.1"
[[ " $(networks order-processor)" == *" $net "* ]] || fail "connect order-processor to $net"
[[ "$(networks payment-handler)" == "$net " ]] \
  || fail "payment-handler must be on $net only (it's on: $(networks payment-handler)); disconnect it from bridge"
[[ "$(networks notification-service)" == "$net " ]] \
  || fail "start notification-service on $net only (--network $net); it's on: $(networks notification-service)"
[[ "$(published_port order-processor 8000)" == 8080 ]] || fail "order-processor must still publish 8080 (don't recreate it without -p 8080:8000)"
ok "containers on $net"

aliases="$(inspect_jq payment-handler ".NetworkSettings.Networks[\"$net\"].Aliases // [] | join(\" \")")"
[[ " $aliases " == *" payments "* ]] || fail "give payment-handler the alias payments on $net (--alias / --network-alias)"
ok "payment-handler is also known as payments"

get() {
  dk exec order-processor python -c "import urllib.request; print(urllib.request.urlopen('$1', timeout=3).read().decode())" 2>/dev/null || true
}
[[ "$(get http://payment-handler:8000/health)" == *'"status":"ok"'* ]] || fail "order-processor can't reach http://payment-handler:8000/health"
[[ "$(get http://payments:8000/health)" == *'"status":"ok"'* ]] || fail "order-processor can't reach http://payments:8000/health"
[[ "$(get http://notification-service:8080/health)" == *'"status":"ok"'* ]] \
  || fail "order-processor can't reach http://notification-service:8080/health"
ok "order-processor reaches its neighbours by name"

need_answer payment-ip "payment-handler's IP address on $net"
[[ "$(answer payment-ip)" == "$(inspect_jq payment-handler ".NetworkSettings.Networks[\"$net\"].IPAddress")" ]] \
  || fail "~/answers/payment-ip is not payment-handler's address on $net"
ok "payment-handler's IP"

pass "the order services find each other by name on $net"
