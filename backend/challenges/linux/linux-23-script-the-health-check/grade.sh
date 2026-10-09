#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

s=/usr/local/bin/check-health
reg=/etc/order-platform/services

box_ok "test -f $s" || fail "$s does not exist"
box_ok "test -x $s" || fail "$s is not executable"
head1="$(in_box "head -1 $s")"
[[ "$head1" =~ ^#!(/usr)?/bin/(env\ )?bash ]] || fail "$s should start with a bash shebang (#!/bin/bash or #!/usr/bin/env bash)"
ok "script installed"

# run <args> — prints "<exit code>|<stdout>|<stderr>" running the script as learner.
run() {
  as_learner "out=\$(mktemp); err=\$(mktemp); timeout 15 $s $* >\$out 2>\$err; c=\$?; echo \"\$c|\$(cat \$out)|\$(cat \$err)\"; rm -f \$out \$err" 2>/dev/null
}
expect() {
  local args=$1 code=$2 out=$3 what=$4 r
  r="$(run "$args")"
  [[ "${r%%|*}" == "$code" ]] || fail "check-health $args should exit $code ($what); it exited ${r%%|*}"
  if [[ -n "$out" ]]; then
    local stdout="${r#*|}"; stdout="${stdout%|*}"
    [[ "$stdout" == "$out" ]] || fail "check-health $args should print '$out' on stdout ($what); it printed '$stdout'"
  fi
}

r="$(run "")"
[[ "${r%%|*}" == 2 ]] || fail "check-health with no arguments should exit 2 (usage error); it exited ${r%%|*}"
[[ -n "${r##*|}" ]] || fail "check-health with no arguments should print a usage message on stderr"
ok "no arguments: usage on stderr, exit 2"

expect "order-processor" 0 "order-processor OK" "healthy service"
expect "payment-handler" 0 "payment-handler OK" "healthy service"
expect "notification-service" 1 "notification-service DOWN" "service is down"
expect "inventory-service" 3 "" "not in $reg"
ok "OK / DOWN / unknown"

in_box "systemctl stop payment-handler"
expect "payment-handler" 1 "payment-handler DOWN" "payment-handler was just stopped"
in_box "systemctl start payment-handler"
ok "reacts to a service going down"

port=$((20000 + RANDOM % 20000))
trap 'in_box "sed -i /^grade-probe/d $reg; pkill -f \"nc -l -N 127.0.0.1 $port\"" >/dev/null 2>&1 || true' EXIT
in_box "echo 'grade-probe            $port' >> $reg"
in_box "setsid bash -c 'printf \"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok\" | nc -l -N 127.0.0.1 $port' >/dev/null 2>&1 < /dev/null &"
sleep 0.5
expect "grade-probe" 0 "grade-probe OK" "a service added to $reg on port $port — read ports from the file, don't hardcode them"
ok "ports come from $reg"

pass "check-health works"
