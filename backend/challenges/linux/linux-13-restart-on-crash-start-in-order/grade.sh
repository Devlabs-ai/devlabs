#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

op=order-processor.service
prop() { in_box "systemctl show -p $1 --value $op"; }
has_word() { [[ " $1 " == *" $2 "* ]]; }
active() { [[ "$(in_box "systemctl is-active $1 2>/dev/null || true")" == active ]]; }
wait_active() { for _ in $(seq 1 15); do active "$1" && return 0; sleep 1; done; return 1; }

box_ok "sha256sum -c --quiet /var/lib/devlabs/order-processor.unit.sha256" \
  || fail "/lib/systemd/system/order-processor.service was modified — leave the vendor unit alone and use a drop-in"
! box_ok "test -f /etc/systemd/system/$op" || fail "/etc/systemd/system/$op replaces the whole vendor unit; use a drop-in (systemctl edit) instead"
dropins="$(prop DropInPaths)"
[[ "$dropins" == */etc/systemd/system/order-processor.service.d/*.conf* ]] \
  || fail "no drop-in found in /etc/systemd/system/order-processor.service.d/ (did you run daemon-reload?)"
ok "drop-in in place, vendor unit untouched"

has_word "$(prop Requires)" payment-handler.service || fail "order-processor should Require payment-handler.service"
has_word "$(prop After)" payment-handler.service || fail "order-processor should start After payment-handler.service"
[[ "$(prop Restart)" == on-failure ]] || fail "order-processor should have Restart=on-failure"
ok "Requires, After, Restart"

in_box "systemctl stop $op payment-handler.service; systemctl reset-failed $op payment-handler.service 2>/dev/null || true"
in_box "systemctl start $op" >/dev/null 2>&1 || true
wait_active $op || fail "starting order-processor from cold did not bring it up (is payment-handler started first?)"
active payment-handler.service || fail "starting order-processor did not also start payment-handler"
box_ok "curl -fsS --max-time 3 http://127.0.0.1:8080/health" || fail "order-processor is active but /health on :8080 is not answering"
ok "cold start pulls in payment-handler first"

pid="$(prop MainPID)"
in_box "kill -9 $pid"
sleep 1
for _ in $(seq 1 15); do
  new="$(prop MainPID)"
  [[ "$new" != 0 && "$new" != "$pid" ]] && active $op && break
  sleep 1
done
[[ "${new:-0}" != 0 && "$new" != "$pid" ]] || fail "after kill -9, systemd did not restart order-processor"
ok "restarted after a crash"

in_box "systemctl stop payment-handler.service"
sleep 1
! active $op || fail "stopping payment-handler should also stop order-processor (that's what Requires= does)"
in_box "systemctl start $op" >/dev/null 2>&1 || true
wait_active $op || fail "order-processor did not come back up"
ok "stop propagates through Requires="

pass "order-processor restarts on crash and starts in order"
