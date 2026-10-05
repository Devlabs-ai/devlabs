#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

O=/opt/order-processor
R=$O/releases
tgz=/var/backups/order-processor-v1.2.tar.gz

box_ok "test -f $tgz" || fail "$tgz does not exist"
box_ok "gzip -t $tgz" || fail "$tgz is not a valid gzip file"
list="$(in_box "tar -tzf $tgz")"
grep -qE '^(\./)?v1\.2/VERSION$' <<<"$list" || fail "$tgz should contain v1.2/VERSION (archive paths start with v1.2/, not the full /opt path)"
grep -qE '^(\./)?v1\.2/bin/order-processor$' <<<"$list" || fail "$tgz is missing v1.2/bin/order-processor"
[[ "$(in_box "tar -xzOf $tgz --wildcards '*v1.2/VERSION'")" == 1.2 ]] || fail "$tgz doesn't hold the v1.2 release"
ok "v1.2 archived"

! box_ok "test -e $R/v1.2" || fail "$R/v1.2 should be removed after archiving"
ok "v1.2 removed"

box_ok "test -L $O/current" || fail "$O/current must be a symlink"
[[ "$(in_box "readlink -f $O/current")" == "$R/v1.1" ]] || fail "$O/current should point at the v1.1 release"
box_ok "$O/current/bin/order-processor | grep -q 'v1.1'" || fail "running $O/current/bin/order-processor doesn't run v1.1"
ok "current -> v1.1"

[[ "$(in_box "cat $R/v1.0/VERSION 2>/dev/null || true")" == 1.0 ]] || fail "restore v1.0 from its backup into $R/v1.0"
box_ok "test -x $R/v1.0/bin/order-processor" || fail "$R/v1.0/bin/order-processor lost its executable bit"
ok "v1.0 restored"

box_ok "test -L /etc/order-processor/app.conf" || fail "/etc/order-processor/app.conf must be a symlink"
[[ "$(in_box "readlink /etc/order-processor/app.conf")" =~ ^(/opt/order-processor/current/app\.conf|\.\./\.\./opt/order-processor/current/app\.conf)$ ]] \
  || fail "/etc/order-processor/app.conf should link to /opt/order-processor/current/app.conf (through current, so it follows rollbacks)"
box_ok "grep -q 'version = v1.1' /etc/order-processor/app.conf" || fail "/etc/order-processor/app.conf doesn't resolve to v1.1's config"
ok "config symlink follows current"

box_ok "test -f /var/backups/app.conf.v1.1 && test ! -L /var/backups/app.conf.v1.1" || fail "/var/backups/app.conf.v1.1 must exist as a regular file (a hard link, not a symlink)"
[[ "$(in_box "stat -c %i /var/backups/app.conf.v1.1")" == "$(in_box "stat -c %i $R/v1.1/app.conf")" ]] \
  || fail "/var/backups/app.conf.v1.1 should be a hard link to $R/v1.1/app.conf (same inode), not a copy"
ok "hard-linked config backup"

pass "releases archived and rolled back"
