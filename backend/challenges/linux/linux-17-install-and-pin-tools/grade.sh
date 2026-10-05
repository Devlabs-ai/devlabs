#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

status() { in_box "dpkg-query -W -f '\${Status}' $1 2>/dev/null || true"; }

[[ "$(status ncdu)" == "install ok installed" ]] || fail "ncdu is not installed"
box_ok "command -v ncdu" || fail "ncdu is installed but not on PATH"
ok "ncdu installed"

box_ok "apt-mark showhold | grep -qx jq" || fail "jq is not on hold (apt-mark hold)"
ok "jq held"

st="$(status htop)"
[[ "$st" != *"ok installed"* ]] || fail "htop is still installed"
[[ "$st" != *"config-files"* ]] || fail "htop was removed but its config files remain; purge it"
ok "htop purged"

need_answer dig-package "the package that provides /usr/bin/dig"
[[ "$(answer dig-package)" == "$(in_box "dpkg -S /usr/bin/dig | cut -d: -f1")" ]] \
  || fail "~/answers/dig-package should be the name of the package that owns /usr/bin/dig"
ok "dig package"

need_answer cron-version "the installed version of cron"
[[ "$(answer cron-version)" == "$(in_box "dpkg-query -W -f '\${Version}' cron")" ]] \
  || fail "~/answers/cron-version should be cron's installed version, exactly as dpkg reports it"
ok "cron version"

pass "tools installed and pinned"
