#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

need_answer box-ip "this box's IPv4 address on eth0"
[[ "$(answer box-ip)" == "$(in_box "ip -4 -o addr show dev eth0 | awk '{print \$4}' | cut -d/ -f1 | head -1")" ]] \
  || fail "~/answers/box-ip should be the IPv4 address on eth0 (just the address, no /prefix)"
ok "box IP"

need_answer resolver "the DNS server this box uses"
[[ "$(answer resolver)" == "$(in_box "awk '/^nameserver/ {print \$2; exit}' /etc/resolv.conf")" ]] \
  || fail "~/answers/resolver should be the first nameserver from /etc/resolv.conf"
ok "resolver"

need_answer payment-ip-before "what payment.internal resolved to before your fix"
[[ "$(answer payment-ip-before)" == 10.99.0.7 ]] || fail "~/answers/payment-ip-before is not what payment.internal originally resolved to"
need_answer payment-port-before "the port payment-handler was actually listening on"
[[ "$(answer payment-port-before)" == 9099 ]] || fail "~/answers/payment-port-before is not the port payment-handler was listening on"
ok "diagnosis recorded"

[[ "$(in_box "getent hosts payment.internal | awk '{print \$1}'")" == 127.0.0.1 ]] \
  || fail "payment.internal should resolve to 127.0.0.1 (payment-handler runs on this box)"
ok "payment.internal -> 127.0.0.1"

[[ "$(in_box 'systemctl is-active payment-handler 2>/dev/null || true')" == active ]] || fail "payment-handler is not running"
box_ok "grep -qx 'PAYMENT_HANDLER_PORT=9090' /etc/payment-handler/payment-handler.env" \
  || fail "set PAYMENT_HANDLER_PORT=9090 in /etc/payment-handler/payment-handler.env"
for _ in $(seq 1 8); do box_ok "ss -Htln 'sport = :9090' | grep -q ." && break; sleep 1; done
box_ok "ss -Htln 'sport = :9090' | grep -q ." || fail "nothing listens on port 9090 (restart payment-handler after changing its env file)"
ok "payment-handler on :9090"

box_ok "/opt/order-processor/bin/check-payments" || fail "/opt/order-processor/bin/check-payments still can't reach payment-handler"
ok "order-processor reaches payment-handler"

pass "order can reach payment"
