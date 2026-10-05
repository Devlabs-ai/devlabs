#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

s=/home/learner/bin/process-batches
ishell() { as_learner "bash -ic $(printf '%q' "$1") 2>/dev/null" 2>/dev/null || true; }

box_ok "test -x $s" || fail "$s does not exist or is not executable"
[[ "$(in_box "stat -c %U $s")" == learner ]] || fail "$s should be owned by learner"
box_ok "grep -qE '^[[:space:]]*(function[[:space:]]+[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\(\))' $s" \
  || fail "$s should define at least one function (e.g. count_orders() { ... })"
ok "script exists and uses a function"

[[ "$(ishell 'command -v process-batches' | tail -1)" == "$s" ]] \
  || fail "process-batches is not on learner's PATH in a new shell (add ~/bin to PATH in ~/.bashrc)"
[[ "$(ishell 'echo "$ORDER_SPOOL"' | tail -1)" == /var/spool/orders ]] \
  || fail "ORDER_SPOOL should be exported as /var/spool/orders in ~/.bashrc"
ok "~/.bashrc sets PATH and ORDER_SPOOL"

[[ "$(in_box "find /var/spool/orders/incoming -name '*.csv' | wc -l")" == 0 ]] \
  || fail "/var/spool/orders/incoming still has batches — run process-batches on the real spool too"
[[ "$(in_box "find /var/spool/orders/processed -name '*.csv' | wc -l")" -ge 3 ]] \
  || fail "the processed batches are missing from /var/spool/orders/processed"
ok "real spool processed"

sp="/tmp/grade-spool-$RANDOM"
trap 'in_box "rm -rf $sp" >/dev/null 2>&1 || true' EXIT
box_script <<EOF
install -d -o learner -g learner $sp $sp/incoming $sp/processed
names=("a-$RANDOM.csv" "b $RANDOM.csv" "c-$RANDOM.csv" "d-$RANDOM.csv")
for f in "\${names[@]}"; do
  { echo "order_id,customer,amount"; for j in \$(seq 1 \$((RANDOM % 30 + 1))); do echo "ORD-\$j,c,1.00"; done; } > "$sp/incoming/\$f"
done
echo "not,a,batch" > "$sp/incoming/notes.txt"
chown -R learner:learner $sp
EOF
want="$(in_box "cd $sp/incoming && t=0; for f in *.csv; do n=\$((\$(wc -l < \"\$f\") - 1)); t=\$((t + n)); echo \"\$f \$n\"; done; echo \"TOTAL \$t\"")"
got="$(as_learner "ORDER_SPOOL=$sp $s" 2>/dev/null || true)"
[[ "$got" == "$want" ]] || fail "with ORDER_SPOOL=$sp the output should be:
$want
but was:
$got"
[[ "$(in_box "find $sp/incoming -name '*.csv' | wc -l")" == 0 && "$(in_box "find $sp/processed -name '*.csv' | wc -l")" == 4 ]] \
  || fail "every .csv batch should be moved from \$ORDER_SPOOL/incoming to \$ORDER_SPOOL/processed"
box_ok "test -f $sp/incoming/notes.txt" || fail "only .csv files are batches; leave other files in incoming"
ok "counts, total and moves are right (including a name with a space)"

got="$(as_learner "ORDER_SPOOL=$sp $s" 2>/dev/null || true)"
[[ "$got" == "TOTAL 0" ]] || fail "with no batches waiting, the output should be just 'TOTAL 0' (got '$got')"
ok "empty spool prints TOTAL 0"

pass "batch processing script works"
