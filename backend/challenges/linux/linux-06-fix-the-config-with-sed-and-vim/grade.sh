#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

conf=/etc/order-processor/app.conf
has() { box_ok "grep -qE '$1' $conf"; }

box_ok "test -f $conf.bak" || fail "$conf.bak does not exist (keep a backup of the original before editing)"
box_ok "cmp -s /var/lib/devlabs/app.conf.orig $conf.bak" || fail "$conf.bak is not an unmodified copy of the original config"
ok "backup"

! has 'queue-old\.internal' || fail "app.conf still mentions queue-old.internal (replace every occurrence, not just the first)"
[[ "$(in_box "grep -c 'queue\.internal' $conf")" == 2 ]] || fail "both queue URLs (url and fallback) should point at queue.internal"
has '^url = amqp://queue\.internal:5672$' || fail "url should be amqp://queue.internal:5672"
has '^fallback = amqp://queue\.internal:5673$' || fail "fallback should be amqp://queue.internal:5673"
has '^endpoint = http://payment-old\.internal:9090$' || fail "the payments endpoint changed; only the queue host was meant to change"
ok "queue host replaced"

has '^log_level = info$' || fail "log_level should be info"
! has 'TODO' || fail "app.conf still has TODO lines; delete them"
has '^metrics_port = 9100$' || fail "metrics_port = 9100 should be uncommented (no leading #)"
ok "log level, TODOs, metrics"

section="$(in_box "awk '/^\\[/{s=\$0} /^max_retries *= *5\$/{print s}' $conf")"
[[ "$section" == "[queue]" ]] || fail "add 'max_retries = 5' inside the [queue] section"
ok "max_retries under [queue]"

for line in '^\[server\]$' '^host = 0\.0\.0\.0$' '^port = 8080$' '^prefetch = 20$' '^\[payments\]$' '^timeout = 5s$'; do
  has "$line" || fail "a line that should be untouched is missing or changed (pattern $line)"
done
ok "rest of the file intact"

pass "config fixed"
