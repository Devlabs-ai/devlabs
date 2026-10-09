#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

f=/etc/logrotate.d/notification-service
dir=/var/log/notification-service
log=$dir/notification.log

box_ok "test -f $f" || fail "$f does not exist"
[[ "$(in_box "stat -c '%U %a' $f")" =~ ^root\ 6[04][04]$ ]] || fail "$f must be owned by root and not group/world-writable"
box_ok "grep -qE '^[[:space:]]*/var/log/notification-service/(\*|\*\.log)[[:space:]]*\{' $f" \
  || fail "$f should start a block for /var/log/notification-service/*.log"
for d in daily 'rotate[[:space:]]+7' compress missingok notifempty copytruncate; do
  box_ok "grep -qE '^[[:space:]]*$d[[:space:]]*\$' $f" || fail "$f is missing the directive: ${d//\[\[:space:\]\]+/ }"
done
out="$(in_box "logrotate -d $f 2>&1" || true)"
grep -qi 'error' <<<"$out" && fail "logrotate -d reports an error: $(grep -i -m1 error <<<"$out")"
ok "config parses with the required directives"

[[ "$(in_box 'systemctl is-active notification-service 2>/dev/null || true')" == active ]] \
  || fail "notification-service must keep running"
pid="$(in_box 'systemctl show -p MainPID --value notification-service')"
inode="$(in_box "stat -c %i $log")"
in_box "rm -f $dir/*.log.* ; logrotate -f -s /tmp/.grade-logrotate.state $f" >/dev/null 2>&1 \
  || fail "logrotate -f $f failed (run it yourself to see why)"
box_ok "ls $dir/notification.log.1 $dir/notification.log.1.gz 2>/dev/null | grep -q ." \
  || fail "forcing a rotation didn't produce notification.log.1 (or .1.gz)"
[[ "$(in_box "stat -c %i $log")" == "$inode" ]] \
  || fail "notification.log was replaced by a new file; the service still writes to the old one (use copytruncate)"
sleep 5
[[ "$(in_box "systemctl show -p MainPID --value notification-service")" == "$pid" ]] || fail "notification-service was restarted during rotation"
box_ok "grep -q heartbeat $log" || fail "after rotation, the service's new lines don't land in notification.log"
[[ "$(in_box "stat -c %s $log")" -lt 100000 ]] || fail "notification.log was not truncated by the rotation"
ok "rotation keeps the service logging to notification.log"

pass "notification logs rotate"
