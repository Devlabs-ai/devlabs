#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

notes=/home/learner/notes/first-shift.txt

box_ok "test -f $notes" || fail "$notes does not exist (create the notes folder and file in your home directory)"
owner="$(in_box "stat -c %U $notes")"
[[ "$owner" == learner ]] || fail "$notes is owned by $owner; create it as learner, without sudo"

version="$(in_box 'cat /opt/order-processor/.release')"
port="$(in_box "awk -F' *= *' '/^port/ {print \$2}' /etc/order-processor/app.conf")"
biggest="$(in_box 'ls -S /var/log/order-processor | head -1')"

lines=()
while IFS= read -r line || [[ -n "$line" ]]; do lines+=("$line"); done < <(in_box "sed -e 's/[[:space:]]*\$//' $notes")
[[ "${#lines[@]}" -ge 3 ]] || fail "$notes needs three lines (version, port, biggest log file); it has ${#lines[@]}"

[[ "${lines[0]}" == "$version" ]] || fail "line 1 should be the release version from /opt/order-processor/.release"
ok "release version"
[[ "${lines[1]}" == "$port" ]] || fail "line 2 should be the port from /etc/order-processor/app.conf"
ok "port"
[[ "${lines[2]}" == "$biggest" ]] || fail "line 3 should be the file name (not the path) of the biggest log in /var/log/order-processor"
ok "biggest log file"

pass "first-shift notes are correct"
