#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

hog="$(in_box 'cat /var/lib/devlabs/runaway.pid')"

need_answer runaway-pid "the PID of the process burning the CPU"
[[ "$(answer runaway-pid | tr -d ' ')" == "$hog" ]] || fail "~/answers/runaway-pid is not the PID of the CPU-burning process"
ok "runaway PID identified"

! box_ok "kill -0 $hog" || fail "the runaway process (PID $hog) is still running — it ignores SIGTERM"
! box_ok "pgrep -f /opt/order-processor/bin/order-reindex" || fail "an order-reindex process is still running"
ok "runaway process killed"

rb="$(in_box "pgrep -u orders -f /opt/order-processor/bin/report-builder | head -1" || true)"
[[ -n "$rb" ]] || fail "report-builder is not running anymore — it should be deprioritized, not killed"
[[ "$(in_box "ps -o ni= -p $rb" | tr -d ' ')" == 15 ]] || fail "report-builder (PID $rb) should run at nice 15"
ok "report-builder reniced to 15"

box_ok "pgrep -u orders -f /opt/notification-service/bin/notification-retry" \
  || fail "notification-retry was killed — leave healthy processes alone"
ok "notification-retry untouched"

pass "runaway process handled"
