#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

log=/var/log/order-processor/orders-2026-09-30.log
A=/home/learner/answers

box_ok "test -f $log" || fail "$log is gone — read it, don't change it"

need_answer line-count "the number of lines in $log"
[[ "$(answer line-count | tr -d ' ')" == "$(in_box "wc -l < $log" | tr -d ' ')" ]] \
  || fail "~/answers/line-count should be the number of lines in the log (just the number)"
ok "line count"

need_answer first-10.txt "the first 10 lines of the log"
box_ok "head -n 10 $log | cmp -s - $A/first-10.txt" || fail "~/answers/first-10.txt should be exactly the first 10 lines of the log"
ok "first 10 lines"

need_answer last-5.txt "the last 5 lines of the log"
box_ok "tail -n 5 $log | cmp -s - $A/last-5.txt" || fail "~/answers/last-5.txt should be exactly the last 5 lines of the log"
ok "last 5 lines"

need_answer line-1500 "line number 1500 of the log"
box_ok "sed -n 1500p $log | cmp -s - $A/line-1500" || fail "~/answers/line-1500 should be exactly line 1500 of the log"
ok "line 1500"

need_answer handoff-code "the latest shift handoff code from live.log"
code="$(answer handoff-code | tail -1)"
recent="$(in_box "grep -o 'code=[A-Z0-9]*' /var/log/order-processor/live.log | tail -2 | cut -d= -f2")"
grep -qxF -- "$code" <<<"$recent" \
  || fail "~/answers/handoff-code is not the current handoff code (it changes every 30 seconds — follow the live log)"
ok "handoff code"

pass "order logs read correctly"
