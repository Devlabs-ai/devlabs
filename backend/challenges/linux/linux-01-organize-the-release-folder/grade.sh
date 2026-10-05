#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

H=/home/learner
in_dir() { in_box "cd '$1' 2>/dev/null && ls -A | sort | tr '\n' ' ' | sed 's/ \$//'"; }

for d in bin config logs; do
  box_ok "test -d $H/release/$d" || fail "~/release/$d does not exist"
done
[[ "$(in_box "find $H/release -not -user learner | wc -l")" == 0 ]] \
  || fail "everything under ~/release must be owned by learner (don't use sudo)"
ok "folder layout"

[[ "$(in_dir $H/release/config)" == "order-processor.conf payment handler.conf queue.conf" ]] \
  || fail "~/release/config should hold exactly the three .conf files (including 'payment handler.conf'); found: $(in_dir $H/release/config)"
[[ "$(in_dir $H/release/logs)" == "orders-2026-09-28.log orders-2026-09-29.log orders-2026-09-30.log" ]] \
  || fail "~/release/logs should hold exactly the three .log files; found: $(in_dir $H/release/logs)"
ok "configs and logs moved"

box_ok "test -x $H/release/bin/order-processor" || fail "~/release/bin/order-processor is missing or not executable"
box_ok "test -x $H/incoming/order-processor" || fail "~/incoming/order-processor is gone; copy the binary, don't move it"
box_ok "cmp -s $H/release/bin/order-processor $H/incoming/order-processor" || fail "~/release/bin/order-processor differs from the original"
ok "binary copied"

box_ok "test -f $H/release/README.md" || fail "~/release/README.md does not exist (move and rename README)"
box_ok "grep -q 'v1.3' $H/release/README.md" || fail "~/release/README.md doesn't contain the release notes"
ok "README.md"

[[ "$(in_dir $H/incoming)" == "order-processor" ]] \
  || fail "~/incoming should only contain order-processor now (no .tmp files, no empty old/); found: $(in_dir $H/incoming)"
ok "incoming cleaned up"

pass "release folder organized"
