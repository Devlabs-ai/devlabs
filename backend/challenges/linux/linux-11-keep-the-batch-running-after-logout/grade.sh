#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

log=/home/learner/batch-export.log
pids="$(in_box "pgrep -f '^(/bin/bash |bash )?/opt/order-processor/bin/batch-export'" || true)"
[[ -n "$pids" ]] || fail "batch-export is not running"
[[ "$(wc -l <<<"$pids" | tr -d ' ')" == 1 ]] || fail "more than one batch-export is running; keep exactly one (kill the extras)"
pid="$pids"
[[ "$(in_box "ps -o user= -p $pid" | tr -d ' ')" == learner ]] || fail "batch-export should run as learner, not root (no sudo)"
ok "one batch-export running as learner (PID $pid)"

box_ok "test -f $log" || fail "$log does not exist — send batch-export's output there"
before="$(in_box "stat -c %s $log")"
sleep 3
after="$(in_box "stat -c %s $log")"
(( after > before )) || fail "$log is not growing — batch-export's output should go to that file"
box_ok "grep -q 'exported batch' $log" || fail "$log doesn't contain batch-export's progress lines"
ok "output goes to ~/batch-export.log"

in_box "kill -HUP $pid"
sleep 1
box_ok "kill -0 $pid" || fail "batch-export died on SIGHUP (what a terminal sends when it closes) — start it with nohup"
ok "survives SIGHUP"

pass "batch survives logout"
