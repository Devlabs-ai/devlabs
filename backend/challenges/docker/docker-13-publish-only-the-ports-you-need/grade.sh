#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker

for c in order-processor payment-handler notification-service; do
  container_exists "$c" || fail "no container named $c"
  [[ "$(container_state "$c")" == running ]] || fail "$c is not running"
  inspect "$c" '{{range $n, $_ := .NetworkSettings.Networks}}{{println $n}}{{end}}' | grep -qx orders-net \
    || fail "$c must be on orders-net"
done
ok "all three running on orders-net"

bindings() { inspect_jq "$1" '[.NetworkSettings.Ports // {} | to_entries[] | select(.value != null) | .key as $p | .value[] | "\(.HostIp):\(.HostPort)->\($p)"] | sort | join(" ")'; }

[[ -z "$(bindings payment-handler)" ]] \
  || fail "payment-handler must not publish any port, only order-processor talks to it (it has: $(bindings payment-handler))"
ok "payment-handler is not published"

nb="$(bindings notification-service)"
[[ "$nb" == "127.0.0.1:8090->8080/tcp" ]] \
  || fail "notification-service must be published on 127.0.0.1:8090 only (-p 127.0.0.1:8090:8080); it has: ${nb:-nothing}"
ok "notification-service on 127.0.0.1:8090 only"

ob="$(bindings order-processor)"
[[ "$ob" == *"0.0.0.0:8080->8000/tcp"* ]] || fail "order-processor must stay published on 8080 for everyone (-p 8080:8000); it has: ${ob:-nothing}"
ok "order-processor on 8080"

# From the order box's own address (what other machines see) vs from localhost.
ip="$(in_box "hostname -I | awk '{print \$1}'")"
[[ "$(in_box "curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://$ip:8080/health" 2>/dev/null || true)" == 200 ]] \
  || fail "order-processor isn't reachable at $ip:8080"
[[ "$(in_box "curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://$ip:8090/health" 2>/dev/null || true)" != 200 ]] \
  || fail "notification-service still answers on $ip:8090; other machines can reach it"
[[ "$(in_box "curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8090/health" 2>/dev/null || true)" == 200 ]] \
  || fail "notification-service doesn't answer on 127.0.0.1:8090"
[[ "$(in_box "curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://$ip:8000/health" 2>/dev/null || true)" != 200 ]] \
  || fail "something still answers on $ip:8000"
ok "from outside: only 8080; from the box: 8080 and 8090"

reply="$(dk exec order-processor python -c "import urllib.request; print(urllib.request.urlopen('http://payment-handler:8000/health', timeout=3).read().decode())" 2>/dev/null || true)"
[[ "$reply" == *'"status":"ok"'* ]] || fail "order-processor can no longer reach http://payment-handler:8000"
ok "order-processor still reaches payment-handler"

pass "the order box exposes only what it should"
