#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_ok "getent group payments-team" || fail "group payments-team does not exist"
ok "group payments-team"

for u in priya marco; do
  box_ok "id $u" || fail "user $u does not exist"
  [[ "$(in_box "getent passwd $u | cut -d: -f6")" == "/home/$u" ]] || fail "$u's home directory should be /home/$u"
  box_ok "test -d /home/$u" || fail "/home/$u was not created (useradd -m)"
  [[ "$(in_box "stat -c %U /home/$u")" == "$u" ]] || fail "/home/$u should be owned by $u"
  [[ "$(in_box "getent passwd $u | cut -d: -f7")" == /bin/bash ]] || fail "$u's login shell should be /bin/bash"
  box_ok "id -nG $u | tr ' ' '\n' | grep -qx payments-team" || fail "$u is not in payments-team"
done
box_ok "id -nG marco | tr ' ' '\n' | grep -qx adm" || fail "marco should also be in adm (log access for on-call)"
! box_ok "id -nG priya | tr ' ' '\n' | grep -qxE 'adm|sudo'" || fail "priya should not be in adm or sudo"
! box_ok "id -nG marco | tr ' ' '\n' | grep -qx sudo" || fail "marco should not be in the sudo group; use the sudoers drop-in instead"
ok "users priya and marco"

f=/etc/sudoers.d/payments-team
box_ok "test -f $f" || fail "$f does not exist"
[[ "$(in_box "stat -c '%U:%G %a' $f")" == "root:root 440" ]] || fail "$f must be root:root mode 440 (sudo ignores unsafe files)"
box_ok "visudo -cqf $f" || fail "$f has a syntax error (check it with visudo -cf)"
ok "sudoers drop-in is valid"

box_ok "runuser -u priya -- sudo -n /usr/bin/systemctl restart payment-handler" \
  || fail "priya cannot run 'sudo systemctl restart payment-handler' without a password"
box_ok "runuser -u marco -- sudo -n /usr/bin/systemctl status payment-handler" \
  || fail "marco cannot run 'sudo systemctl status payment-handler' without a password"
! box_ok "runuser -u priya -- sudo -n /usr/bin/cat /etc/shadow" \
  || fail "priya can run arbitrary commands with sudo; allow only the payment-handler restart/status commands"
! box_ok "runuser -u priya -- sudo -n /usr/bin/systemctl stop ssh" \
  || fail "priya can manage other services with sudo; allow only payment-handler"
ok "sudo limited to payment-handler restart/status"

[[ "$(in_box "passwd -S olek | awk '{print \$2}'")" == L ]] || fail "olek's password is not locked"
[[ "$(in_box "getent passwd olek | cut -d: -f7")" =~ ^(/usr/sbin/nologin|/sbin/nologin|/bin/false|/usr/bin/false)$ ]] \
  || fail "olek's login shell should be /usr/sbin/nologin"
box_ok "test -f /home/olek/runbook.md" || fail "olek's home was deleted; keep it for the audit (lock the account, don't remove it)"
ok "olek offboarded"

pass "payments team onboarded"
