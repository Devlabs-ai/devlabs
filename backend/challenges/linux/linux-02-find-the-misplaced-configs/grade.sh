#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

need_answer orders-configs "list the .conf files under /srv owned by orders, one path per line"
want="$(in_box "find /srv -type f -name '*.conf' -user orders | sort")"
got="$(answer orders-configs | sort)"
[[ "$got" == "$want" ]] || fail "~/answers/orders-configs doesn't match: list every .conf file under /srv owned by orders (full paths, one per line, nothing else)"
ok "orders-owned configs"

box_ok "test -d /var/tmp/order-dumps" || fail "/var/tmp/order-dumps is gone; delete only the big files"
left="$(in_box "find /var/tmp/order-dumps -type f -size +10M | wc -l")"
[[ "$left" == 0 ]] || fail "$left file(s) larger than 10 MiB are still under /var/tmp/order-dumps"
box_ok "test -f /var/tmp/order-dumps/2026-10/dump-just-under.bin" || fail "dump-just-under.bin (9 MiB) was deleted; only remove files larger than 10 MiB"
small="$(in_box "find /var/tmp/order-dumps -type f | wc -l")"
[[ "$small" -ge 1 ]] || fail "all dumps were deleted; only remove files larger than 10 MiB"
ok "big dumps removed"

recent_src="$(in_box "cd /etc/order-processor && find . -type f -mtime -2 -printf '%f\n' | sort")"
recent_got="$(in_box "test -d /home/learner/recent && cd /home/learner/recent && find . -type f -printf '%f\n' | sort" || true)"
[[ -n "$recent_got" ]] || fail "~/recent is missing or empty"
[[ "$recent_got" == "$recent_src" ]] || fail "~/recent should hold exactly the files under /etc/order-processor changed in the last 2 days"
for f in $recent_src; do
  src="$(in_box "find /etc/order-processor -type f -name '$f' | head -1")"
  box_ok "cmp -s '$src' '/home/learner/recent/$f'" || fail "~/recent/$f differs from $src (copy, don't edit)"
done
[[ "$(in_box "find /etc/order-processor -type f | wc -l")" == 8 ]] || fail "files are missing from /etc/order-processor; copy them, don't move them"
ok "recently changed configs copied"

pass "misplaced configs found"
