#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

name=payment-handler

wait_docker

container_exists "$name" || fail "no container named $name"
[[ "$(inspect "$name" '{{.Config.Image}}')" == devsetu/payment-handler:v1.1 ]] || fail "$name must run devsetu/payment-handler:v1.1"
[[ "$(container_state "$name")" == running ]] || fail "$name is not running (docker logs $name)"
ok "$name running"

user="$(inspect "$name" '{{.Config.User}}')"
[[ "$user" != 0 && "$user" != root && "$user" != 0:* && "$user" != root:* ]] \
  || fail "don't run $name as root (drop --user 0; the image already runs as UID 1000)"
[[ "$(dk exec "$name" id -u)" != 0 ]] || fail "$name's processes run as root"
[[ "$(inspect "$name" '{{.HostConfig.Privileged}}')" == false ]] || fail "$name must not be privileged"
ok "runs as UID $(dk exec "$name" id -u)"

[[ "$(inspect_jq "$name" '.HostConfig.CapDrop // [] | join(" ")')" == ALL ]] || fail "drop every Linux capability (--cap-drop ALL)"
[[ "$(inspect_jq "$name" '.HostConfig.CapAdd // [] | length')" == 0 ]] \
  || fail "add no capabilities back: payment-handler needs none (it has $(inspect_jq "$name" '.HostConfig.CapAdd | join(" ")'))"
[[ "$(dk exec "$name" sh -c "awk '/^CapEff/ {print \$2}' /proc/1/status")" == 0000000000000000 ]] \
  || fail "the process still has effective capabilities"
inspect_jq "$name" '.HostConfig.SecurityOpt // [] | .[]' | grep -Eqx 'no-new-privileges(:true|=true)?' \
  || fail "set --security-opt no-new-privileges so setuid binaries can't raise privileges"
ok "no capabilities, no-new-privileges"

[[ "$(inspect "$name" '{{.HostConfig.ReadonlyRootfs}}')" == true ]] || fail "run $name with a read-only root filesystem (--read-only)"
[[ " $(inspect_jq "$name" '.HostConfig.Tmpfs // {} | keys | join(" ")') " == *" /tmp "* ]] \
  || fail "give gunicorn a writable /tmp as tmpfs (--tmpfs /tmp)"
dk_ok exec "$name" sh -c 'touch /app/x' && fail "/app is writable inside $name"
ok "read-only root, tmpfs /tmp"

bind="$(inspect_jq "$name" '[.NetworkSettings.Ports["8000/tcp"] // [] | .[] | "\(.HostIp):\(.HostPort)"] | join(" ")')"
[[ "$bind" == "127.0.0.1:8001" ]] || fail "publish $name on 127.0.0.1:8001 only (-p 127.0.0.1:8001:8000); it has: ${bind:-nothing}"
[[ "$(box_json http://127.0.0.1:8001/health .status)" == ok ]] || fail "http://127.0.0.1:8001/health doesn't answer"
ok "serving on 127.0.0.1:8001"

pass "payment-handler runs with the least privilege it needs"
