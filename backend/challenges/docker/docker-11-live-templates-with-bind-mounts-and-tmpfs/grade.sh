#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

name=notify-preview
src=/home/learner/notify/templates
html=/usr/share/nginx/html
probe=$src/order-shipped.txt
restore() { in_box "sed -i '/^grader-check-/d' $probe" >/dev/null 2>&1 || true; }
trap restore EXIT

wait_docker

container_exists "$name" || fail "no container named $name"
[[ "$(inspect "$name" '{{.Config.Image}}')" == nginx:1.27-alpine ]] || fail "$name must run nginx:1.27-alpine"
[[ "$(container_state "$name")" == running ]] || fail "$name is not running (docker logs $name)"
[[ "$(published_port "$name" 80)" == 8086 ]] || fail "publish $name's port 80 on host port 8086"
ok "$name runs on 8086"

bind="$(inspect_jq "$name" ".Mounts[] | select(.Destination == \"$html\") | \"\(.Type) \(.Source) \(.RW)\"")"
[[ "$bind" == "bind $src "* ]] || fail "bind-mount $src at $html (-v ~/notify/templates:$html or --mount type=bind,...); it has: ${bind:-nothing}"
[[ "$bind" == *" false" ]] || fail "mount the templates read-only (:ro / readonly): nginx should never change them"
ok "templates bind-mounted read-only"

[[ "$(inspect "$name" '{{.HostConfig.ReadonlyRootfs}}')" == true ]] || fail "run $name with a read-only root filesystem (--read-only)"
tmpfs="$(inspect_jq "$name" '.HostConfig.Tmpfs // {} | keys | join(" ")')"
[[ " $tmpfs " == *" /var/cache/nginx "* ]] || fail "give nginx its scratch space as tmpfs at /var/cache/nginx (--tmpfs)"
dk_ok exec "$name" sh -c 'touch /etc/nginx/x' && fail "the root filesystem is writable"
dk_ok exec "$name" sh -c "touch $html/x" && fail "$html is writable inside the container"
ok "read-only root, tmpfs at: $tmpfs"

want="$(in_box "cat $src/order-confirmed.txt")"
[[ "$(box_http http://127.0.0.1:8086/order-confirmed.txt)" == "$want" ]] \
  || fail "http://127.0.0.1:8086/order-confirmed.txt doesn't serve ~/notify/templates/order-confirmed.txt"
check="grader-check-$RANDOM"
in_box "echo $check >> $probe"
[[ "$(box_http http://127.0.0.1:8086/order-shipped.txt)" == *"$check"* ]] \
  || fail "an edit to ~/notify/templates didn't show up in the container: bind-mount the folder, don't copy it"
ok "edits on the box show up instantly"

pass "templates are served live, read-only, from a locked-down nginx"
