#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

d=/srv/notifications/outbox
as() { local u=$1; shift; box_ok "runuser -u $u -- bash -c $(printf '%q' "$*")"; }

box_ok "test -d $d" || fail "$d does not exist"
[[ "$(in_box "stat -c '%U:%G %a' $d")" == "root:notify 3770" ]] \
  || fail "$d is $(in_box "stat -c '%U:%G %a' $d"), want root:notify mode 3770 (setgid + sticky + rwx for owner and group)"
ok "owner, group and special bits"

acl="$(in_box "getfacl -cp $d")"
grep -qx 'user:auditor:r-x' <<<"$acl" || fail "auditor needs an ACL entry user:auditor:r-x on $d"
grep -qx 'default:user:auditor:r-x' <<<"$acl" || grep -qx 'default:user:auditor:r--' <<<"$acl" \
  || fail "add a default ACL for auditor (default:user:auditor:r-x) so new files are readable too"
ok "auditor ACLs"

in_box "rm -f $d/.grade-*"
as order-bot "echo order > $d/.grade-order" || fail "order-bot (in notify) cannot create files in $d"
[[ "$(in_box "stat -c %G $d/.grade-order")" == notify ]] || fail "new files in $d don't inherit the notify group (setgid on the directory)"
as payment-bot "cat $d/.grade-order >/dev/null" || fail "payment-bot cannot read order-bot's file"
! as payment-bot "rm -f $d/.grade-order && test ! -e $d/.grade-order" || fail "payment-bot could delete order-bot's file (sticky bit missing)"
as auditor "ls $d >/dev/null && cat $d/.grade-order >/dev/null" || fail "auditor cannot list the folder and read new files"
! as auditor "touch $d/.grade-auditor" || fail "auditor can write to $d; read-only access only"
! as nobody "ls $d" || fail "users outside notify (other than auditor) can list $d"
in_box "rm -f $d/.grade-*"
ok "access behaves as designed"

pass "shared drop folder works"
