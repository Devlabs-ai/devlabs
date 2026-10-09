#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

u=notification-service.service
prop() { in_box "systemctl show -p $1 --value $u"; }

[[ "$(prop ExecStart)" == *"path=/opt/notification-service/bin/notification-service "* ]] \
  || fail "ExecStart still points at the wrong binary (check the path in the unit, then daemon-reload)"
box_ok "test -x /opt/notification-service/bin/notification-service" \
  || fail "the notification-service binary is not executable"
ok "unit runs the right, executable binary"

box_ok "grep -qE '^SMTP_HOST=smtp\.internal$' /etc/notification-service/notification.env" \
  || fail "notification.env must set SMTP_HOST=smtp.internal (read the service's own error in the journal)"
ok "environment file fixed"

! box_ok "pgrep -f /usr/local/bin/debug-listener" || fail "the leftover debug listener is still running and holding the port"
ok "port 8085 freed"

[[ "$(in_box "systemctl is-enabled $u 2>/dev/null || true")" == enabled ]] || fail "$u should stay enabled"
for _ in $(seq 1 10); do
  [[ "$(in_box "systemctl is-active $u 2>/dev/null || true")" == active ]] && break
  sleep 1
done
[[ "$(in_box "systemctl is-active $u 2>/dev/null || true")" == active ]] || fail "$u is not active (systemctl status $u; journalctl -u $u)"
[[ "$(in_box "ps -o user= -p $(prop MainPID)" | tr -d ' ')" == notify ]] || fail "$u must still run as User=notify"
health="$(in_box "curl -fsS --max-time 3 http://127.0.0.1:8085/health" || true)"
[[ "$health" == *'"service":"notification-service"'* ]] || fail "GET http://127.0.0.1:8085/health is not answered by notification-service"
ok "running as notify and healthy"

pass "notification-service is fixed"
