#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

K=/home/learner/.ssh/id_ed25519
AK=/home/deploy/.ssh/authorized_keys

box_ok "test -f $K && test -f $K.pub" || fail "$K and $K.pub don't exist (ssh-keygen -t ed25519)"
[[ "$(in_box "stat -c '%U %a' $K")" == "learner 600" ]] || fail "$K must be owned by learner with mode 600"
box_ok "ssh-keygen -lf $K.pub | grep -q '(ED25519)'" || fail "the key must be ed25519"
ok "learner has an ed25519 key pair"

box_ok "test -f $AK" || fail "$AK does not exist"
[[ "$(in_box "stat -c '%U %a' /home/deploy/.ssh")" == "deploy 700" ]] || fail "/home/deploy/.ssh must be owned by deploy with mode 700"
[[ "$(in_box "stat -c '%U %a' $AK")" =~ ^deploy\ 6[04]0$ ]] || fail "$AK must be owned by deploy and not readable by others (600)"
box_ok "grep -qF \"\$(awk '{print \$2}' $K.pub)\" $AK" || fail "learner's public key is not in $AK"
ok "key authorized for deploy"

eff="$(in_box "sshd -T 2>/dev/null")"
grep -qx 'passwordauthentication no' <<<"$eff" || fail "sshd still allows password logins (sshd -T | grep passwordauthentication)"
grep -qx 'permitrootlogin no' <<<"$eff" || fail "sshd still allows root logins (sshd -T | grep permitrootlogin)"
ok "sshd config hardened"

who="$(as_learner "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 order-box whoami" 2>/dev/null || true)"
[[ "$who" == deploy ]] || fail "'ssh order-box whoami' as learner didn't log in as deploy (add a Host order-box entry to ~/.ssh/config)"
ok "ssh order-box logs in as deploy with the key"

denied="$(as_learner "ssh -o BatchMode=yes -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 deploy@127.0.0.1 true" 2>&1 || true)"
[[ "$denied" == *"Permission denied (publickey)"* ]] \
  || fail "the running sshd still offers password login — restart ssh after changing its config"
ok "running sshd accepts keys only"

pass "deploy bot uses SSH keys"
