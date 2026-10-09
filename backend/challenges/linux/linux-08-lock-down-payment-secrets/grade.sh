#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

# expect <path> <owner:group> <octal mode> <hint>
expect() {
  local got
  got="$(in_box "stat -c '%U:%G %a' $1 2>/dev/null")" || fail "$1 is missing — don't delete files, fix their permissions"
  [[ "$got" == "$2 $3" ]] || fail "$1 is $got, want $2 mode $3 ($4)"
  ok "$1 $2 $3"
}

expect /etc/payment-handler root:payments 750 "only root writes the directory; the payments group can enter it"
expect /etc/payment-handler/payment-handler.conf root:payments 640 "readable by the service group, nobody else"
expect /etc/payment-handler/secrets.env payment-handler:payments 640 "the service owns its secrets; group read only"
expect /etc/payment-handler/signing.key payment-handler:payments 600 "only payment-handler may read or rewrite the key"
expect /opt/payment-handler/bin/rotate-keys.sh root:payments 750 "root owns code; the group may run it; no one else touches it"
expect /var/log/payment-handler payment-handler:payments 750 "the service writes its logs; the group can read them"
expect /var/log/payment-handler/payment-handler.log payment-handler:payments 640 "logs: service writes, group reads"

box_ok "id -nG learner | tr ' ' '\n' | grep -qx payments" \
  || fail "learner is not in the payments group (use usermod -aG; keep learner's other groups)"
box_ok "id -nG learner | tr ' ' '\n' | grep -qx sudo" \
  || fail "learner lost the sudo group — use usermod -aG (append), not -G"
ok "learner is in payments (and still in sudo)"

box_ok "runuser -u learner -g learner -G payments -- cat /etc/payment-handler/secrets.env" \
  || fail "a payments member cannot read secrets.env"
! box_ok "runuser -u learner -g learner -G payments -- cat /etc/payment-handler/signing.key" \
  || fail "a payments member can read signing.key; it must be payment-handler only"
! box_ok "runuser -u nobody -- ls /etc/payment-handler" \
  || fail "users outside payments can still list /etc/payment-handler"
ok "access works as designed"

pass "payment secrets are locked down"
