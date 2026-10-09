#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

log=/var/log/payment-handler/payments.log
A=/home/learner/answers

need_answer failed.txt "every line mentioning failed, in any letter case"
box_ok "grep -i 'failed' $log | cmp -s - $A/failed.txt" \
  || fail "~/answers/failed.txt should hold every line containing 'failed' in any case (FAILED, Failed, failed), in log order — note 'failure' doesn't count"
ok "failed lines"

need_answer e402-count "how many lines carry the exact code E402"
[[ "$(answer e402-count | tr -d ' ')" == "$(in_box "grep -cw 'code=E402' $log")" ]] \
  || fail "~/answers/e402-count is wrong — count code E402 exactly (E4021 is a different code)"
ok "E402 count"

need_answer declined-orders "unique order IDs on 'declined' lines"
want="$(in_box "grep -w 'declined' $log | grep -oE 'ORD-[0-9]{6}' | sort -u")"
got="$(answer declined-orders | sort -u)"
[[ "$got" == "$want" ]] \
  || fail "~/answers/declined-orders should list each order ID (ORD-xxxxxx) from lines with the word 'declined', once each — 'predeclined' is not a decline"
[[ "$(answer declined-orders | wc -l | tr -d ' ')" == "$(wc -l <<<"$want" | tr -d ' ')" ]] \
  || fail "~/answers/declined-orders has duplicates; list each order once"
ok "declined orders"

need_answer timeout-configs "config files under /etc/payment-handler that set a timeout"
want="$(in_box "grep -rlE '^[a-z_]*timeout *=' /etc/payment-handler | sort")"
got="$(answer timeout-configs | sort)"
[[ "$got" == "$want" ]] \
  || fail "~/answers/timeout-configs should list the files (full paths) that set a timeout setting (a line like 'read_timeout = 5s'), not files that merely mention the word in a comment"
ok "timeout configs"

pass "failed payments found"
