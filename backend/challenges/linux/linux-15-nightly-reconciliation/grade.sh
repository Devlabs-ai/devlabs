#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

svc=order-reconcile.service
tmr=order-reconcile.timer
sprop() { in_box "systemctl show -p $1 --value $svc"; }
tprop() { in_box "systemctl show -p $1 --value $tmr"; }

[[ "$(sprop LoadState)" == loaded ]] || fail "$svc is not loaded (create /etc/systemd/system/$svc, then daemon-reload)"
[[ "$(sprop Type)" == oneshot ]] || fail "$svc should be Type=oneshot (it runs and exits)"
[[ "$(sprop User)" == recon ]] || fail "$svc should run as User=recon"
[[ "$(sprop ExecStart)" == *"path=/opt/order-reconciliation/bin/reconcile "* ]] || fail "$svc should run /opt/order-reconciliation/bin/reconcile"
in_box "rm -f /var/lib/order-reconciliation/last-run"
in_box "systemctl start $svc" >/dev/null 2>&1 || fail "systemctl start $svc failed (journalctl -u $svc)"
[[ "$(sprop Result)" == success ]] || fail "$svc did not finish successfully"
[[ "$(in_box "stat -c %U /var/lib/order-reconciliation/last-run 2>/dev/null || true")" == recon ]] \
  || fail "the reconcile run didn't write /var/lib/order-reconciliation/last-run as recon"
ok "reconcile service runs as recon"

[[ "$(tprop LoadState)" == loaded ]] || fail "$tmr is not loaded"
[[ "$(tprop Unit)" == "$svc" ]] || fail "$tmr should trigger $svc"
[[ "$(tprop TimersCalendar)" == *"OnCalendar=*-*-* 02:30:00 "* ]] || fail "$tmr should fire daily at 02:30 (OnCalendar=*-*-* 02:30:00)"
[[ "$(tprop Persistent)" == yes ]] || fail "$tmr should be Persistent=true (catch up on runs missed while the box was off)"
[[ "$(in_box "systemctl is-enabled $tmr 2>/dev/null || true")" == enabled ]] || fail "$tmr is not enabled"
[[ "$(in_box "systemctl is-active $tmr 2>/dev/null || true")" == active ]] || fail "$tmr is not active (started)"
ok "daily 02:30 timer enabled"

f=/etc/cron.d/notification-digest
box_ok "test -f $f" || fail "$f does not exist"
[[ "$(in_box "stat -c '%U %a' $f")" =~ ^root\ 6[04][04]$ ]] || fail "$f must be owned by root and not group/world-writable (cron ignores it otherwise)"
box_ok "grep -qE '^[[:space:]]*(\*/15|0,15,30,45)[[:space:]]+\*[[:space:]]+\*[[:space:]]+\*[[:space:]]+\*[[:space:]]+notify[[:space:]]+/opt/notification-service/bin/digest[[:space:]]*\$' $f" \
  || fail "$f needs a line running /opt/notification-service/bin/digest every 15 minutes as user notify (system cron files have a user column)"
ok "digest every 15 minutes via /etc/cron.d"

box_ok "crontab -l -u learner 2>/dev/null | grep -qE '^[[:space:]]*0[[:space:]]+7[[:space:]]+\*[[:space:]]+\*[[:space:]]+\*[[:space:]]+/opt/order-processor/bin/disk-report'" \
  || fail "learner's own crontab should run /opt/order-processor/bin/disk-report every day at 07:00"
[[ "$(in_box "systemctl is-active cron 2>/dev/null || true")" == active ]] || fail "the cron service is not running"
ok "learner's crontab"

pass "nightly jobs scheduled"
