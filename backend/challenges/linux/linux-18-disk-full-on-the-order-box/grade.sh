#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

d=/var/log/order-processor
active() { [[ "$(in_box "systemctl is-active $1 2>/dev/null || true")" == active ]]; }

box_ok "mountpoint -q $d" || fail "$d is no longer a mounted volume — free space on it, don't unmount it"

need_answer held-by "the name of the process holding the deleted file open"
answer held-by | grep -q 'order-exporter' || fail "~/answers/held-by should name the process that held the deleted spool file"
ok "culprit identified"

box_ok "test -f $d/order-processor.log.1" || fail "keep the newest rotated log ($d/order-processor.log.1)"
for i in 2 3 4 5; do
  ! box_ok "test -e $d/order-processor.log.$i" || fail "$d/order-processor.log.$i (older rotated log) is still there"
done
box_ok "test -f $d/order-processor.log" || fail "$d/order-processor.log (the live log) was deleted"
ok "old rotated logs removed"

! box_ok "test -e $d/order-processor-heap.hprof" || fail "the heap dump is still on the log volume"
box_ok "test -f /var/tmp/order-processor-heap.hprof" || fail "move the heap dump to /var/tmp/order-processor-heap.hprof (the developers want it)"
[[ "$(in_box "stat -c %s /var/tmp/order-processor-heap.hprof")" == $((7 * 1024 * 1024)) ]] || fail "/var/tmp/order-processor-heap.hprof is incomplete"
ok "heap dump moved off the volume"

held="$(in_box "find /proc/[0-9]*/fd -lname '$d/*(deleted)' 2>/dev/null | wc -l")"
[[ "$held" == 0 ]] || fail "a process still holds a deleted file on $d open (lsof +L1)"
active order-exporter || fail "order-exporter must be running (restart it, don't stop it)"
[[ "$(in_box 'systemctl show -p MainPID --value order-exporter')" != "$(in_box 'cat /var/lib/devlabs/exporter.pid')" ]] \
  || fail "order-exporter is still the original process"
ok "deleted spool released"

use="$(in_box "df --output=pcent $d | tail -1" | tr -dc '0-9')"
(( use < 50 )) || fail "$d is still ${use}% full; get it under 50%"
ok "volume at ${use}%"

for _ in $(seq 1 12); do active order-processor && break; sleep 1; done
active order-processor || fail "order-processor is not running (systemctl status order-processor)"
box_ok "curl -fsS --max-time 3 http://127.0.0.1:8080/health" || fail "order-processor /health is not answering"
ok "order-processor healthy"

pass "disk space recovered"
