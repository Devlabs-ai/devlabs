#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

d=/var/log/order-processor
active() { [[ "$(in_box "systemctl is-active $1 2>/dev/null || true")" == active ]]; }
enabled() { [[ "$(in_box "systemctl is-enabled $1 2>/dev/null || true")" == enabled ]]; }

box_ok "mountpoint -q $d" || fail "$d must stay mounted"
! box_ok "grep -hsE '^[[:space:]]*[^#[:space:]].*debug-dump' /etc/cron.d/* /etc/crontab /var/spool/cron/crontabs/*" \
  || fail "the job that writes debug dumps is still scheduled in cron"
ok "debug-dump cron job removed"

[[ "$(in_box "find $d -name '*.dump' | wc -l")" == 0 ]] || fail "debug dumps are still filling $d"
use="$(in_box "df --output=pcent $d | tail -1" | tr -dc '0-9')"
(( use < 50 )) || fail "$d is still ${use}% full"
box_ok "test -f $d/order-processor.log" || fail "order-processor.log (the live log) was deleted"
ok "log volume at ${use}%"

[[ "$(in_box "stat -c %U /var/lib/order-processor")" == orders ]] || fail "/var/lib/order-processor must be owned by orders (the service user)"
[[ "$(in_box "stat -c %a /var/lib/order-processor")" =~ ^7[0-5][0-5]$ ]] || fail "/var/lib/order-processor should not be group/world-writable"
ok "order-processor state dir"

[[ "$(in_box "systemctl is-enabled payment-handler 2>/dev/null || true")" != masked ]] || fail "payment-handler is still masked"
enabled payment-handler || fail "payment-handler is not enabled (it won't start on boot)"
enabled order-processor || fail "order-processor is not enabled"
ok "both services enabled"

for _ in $(seq 1 12); do active order-processor && active payment-handler && break; sleep 1; done
active payment-handler || fail "payment-handler is not running"
active order-processor || fail "order-processor is not running"
[[ "$(in_box "ps -o user= -p \$(systemctl show -p MainPID --value order-processor)" | tr -d ' ')" == orders ]] || fail "order-processor must run as orders"
box_ok "curl -fsS --max-time 3 http://127.0.0.1:8080/health" || fail "order-processor /health on :8080 is not answering"
box_ok "curl -fsS --max-time 3 http://127.0.0.1:9090/health" || fail "payment-handler /health on :9090 is not answering"
ok "both services healthy"

need_answer incident.md "a short incident write-up"
[[ "$(answer incident.md | wc -l | tr -d ' ')" -ge 3 ]] || fail "~/answers/incident.md should have at least 3 lines: one per root cause you found"
ok "incident write-up"

pass "order box recovered"
