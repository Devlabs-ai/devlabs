#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

csv=/srv/orders/orders.csv
R=/home/learner/reports
norm() { sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]\{1,\}/ /g' -e 's/[[:space:]]*$//' -e '/^$/d'; }
report() { in_box "cat $R/$1" 2>/dev/null | norm; }

box_ok "test -f $R/top-regions.txt" || fail "~/reports/top-regions.txt does not exist"
want="$(in_box "awk -F, 'NR>1 && \$5==\"completed\" {print \$4}' $csv | sort | uniq -c | sort -rn | head -3" | norm)"
[[ "$(report top-regions.txt)" == "$want" ]] \
  || fail "~/reports/top-regions.txt should be the 3 regions with the most completed orders, as 'count region' lines, highest first"
ok "top regions"

box_ok "test -f $R/completed-total.txt" || fail "~/reports/completed-total.txt does not exist"
want="$(in_box "awk -F, 'NR>1 && \$5==\"completed\" {s+=\$6} END {printf \"%.2f\", s}' $csv")"
got="$(report completed-total.txt)"
awk -v a="$got" -v b="$want" 'BEGIN { exit !(a != "" && a + 0 == a && (a - b < 0.005 && b - a < 0.005)) }' \
  || fail "~/reports/completed-total.txt should be the sum of amount over completed orders (e.g. 12345.67); got '$got'"
ok "completed total"

box_ok "test -f $R/failed-customers.txt" || fail "~/reports/failed-customers.txt does not exist"
want="$(in_box "awk -F, 'NR>1 && \$5==\"failed\" {print \$3}' $csv | sort -u")"
[[ "$(report failed-customers.txt)" == "$want" ]] \
  || fail "~/reports/failed-customers.txt should list each customer with at least one failed order, once, sorted"
ok "failed customers"

box_ok "test -f $R/export.csv && test -f $R/export.err" || fail "~/reports/export.csv and ~/reports/export.err must both exist"
box_ok "/opt/order-processor/bin/order-export 2>/dev/null | cmp -s - $R/export.csv" \
  || fail "~/reports/export.csv should hold only order-export's normal output (stdout), no warnings"
box_ok "/opt/order-processor/bin/order-export 2>&1 >/dev/null | cmp -s - $R/export.err" \
  || fail "~/reports/export.err should hold only order-export's warnings (stderr)"
ok "export split into stdout and stderr"

pass "daily order report built"
