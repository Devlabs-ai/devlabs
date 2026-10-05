#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

unit=order-processor.service
prop() { in_box "systemctl show -p $1 --value $unit"; }

box_ok "test -f /etc/systemd/system/$unit" || fail "/etc/systemd/system/$unit does not exist"
[[ "$(prop LoadState)" == loaded ]] || fail "$unit is not loaded (syntax error? did you run systemctl daemon-reload?)"
ok "unit file loaded"

[[ "$(prop ExecStart)" == *"path=/opt/order-processor/bin/order-processor "* ]] \
  || fail "ExecStart must run /opt/order-processor/bin/order-processor"
[[ "$(prop User)" == orders ]] || fail "the service must run as User=orders"
[[ "$(prop EnvironmentFiles)" == /etc/order-processor/order-processor.env* ]] \
  || fail "load settings with EnvironmentFile=/etc/order-processor/order-processor.env (don't copy them into the unit)"
[[ "$(prop Restart)" == on-failure ]] || fail "set Restart=on-failure"
ok "unit spec"

[[ "$(in_box "systemctl is-enabled $unit 2>/dev/null || true")" == enabled ]] \
  || fail "$unit is not enabled; it won't start on boot (systemctl enable, with WantedBy=multi-user.target)"
[[ " $(prop WantedBy) " == *" multi-user.target "* ]] \
  || fail "$unit must be wanted by multi-user.target ([Install] WantedBy=multi-user.target)"
ok "enabled for boot"

[[ "$(in_box "systemctl is-active $unit 2>/dev/null || true")" == active ]] \
  || fail "$unit is not running (check: systemctl status $unit; journalctl -u $unit)"
pid="$(prop MainPID)"
[[ "$(in_box "ps -o user= -p $pid" | tr -d ' ')" == orders ]] || fail "the running process is not owned by orders"
box_ok "curl -fsS --max-time 3 http://127.0.0.1:8080/health" || fail "GET http://127.0.0.1:8080/health failed"
ok "running as orders and healthy"

in_box "kill -9 $pid"
for _ in $(seq 1 20); do
  sleep 1
  new="$(prop MainPID)"
  [[ "$new" != 0 && "$new" != "$pid" ]] && box_ok "systemctl is-active --quiet $unit" && break
done
[[ "${new:-0}" != 0 && "$new" != "$pid" ]] || fail "after a crash (kill -9), systemd did not restart $unit"
box_ok "for i in 1 2 3 4 5; do curl -fsS --max-time 2 http://127.0.0.1:8080/health && exit 0; sleep 1; done; exit 1" \
  || fail "$unit restarted but /health is not answering"
ok "systemd restarted it after a crash"

pass "order-processor runs as a systemd service"
