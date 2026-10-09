#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

name=notification-service
cfg=/home/learner/notify/config.json

wait_docker

need_answer exit-code "the exit code notification-service crashes with"
[[ "$(answer exit-code)" == 78 ]] || fail "~/answers/exit-code is not the code the crashing container exited with (docker ps -a, docker inspect)"
ok "exit code"

box_ok "jq -e . $cfg" || fail "$cfg is not valid JSON (jq . $cfg shows where)"
[[ "$(in_box "jq -r .sender $cfg")" == "$(in_box 'cat /root/.lab/sender')" ]] \
  || fail "fix the JSON syntax without changing the settings (the sender changed)"
[[ "$(in_box "jq -r '.retry.attempts' $cfg")" == 3 ]] || fail "fix the JSON syntax without changing the settings (retry.attempts changed)"
ok "config.json is valid"

container_exists "$name" || fail "no container named $name"
[[ "$(inspect "$name" '{{.Config.Image}}')" == quickbyte/notification-service:1.2 ]] || fail "$name must run quickbyte/notification-service:1.2"
[[ "$(container_env "$name" SMTP_HOST)" == smtp.quickbyte.internal ]] \
  || fail "$name needs SMTP_HOST=smtp.quickbyte.internal (see ~/notify/README.txt)"
mount="$(inspect_jq "$name" '.Mounts[] | select(.Destination == "/etc/notify/config.json") | "\(.Type) \(.Source) \(.RW)"')"
[[ "$mount" == "bind $cfg false" ]] \
  || fail "mount $cfg read-only at /etc/notify/config.json (it has: ${mount:-nothing there})"
ok "settings and config mount"

[[ "$(container_state "$name")" == running ]] || fail "$name is not running (docker logs $name)"
before="$(inspect "$name" '{{.RestartCount}}')"
sleep 6
[[ "$(container_state "$name")" == running && "$(inspect "$name" '{{.RestartCount}}')" == "$before" ]] \
  || fail "$name is still restarting (docker logs --tail 5 $name)"
[[ "$(published_port "$name" 8080)" == 8090 ]] || fail "publish $name on 8090"
[[ "$(box_json http://127.0.0.1:8090/health .version)" == v1.2 ]] || fail "http://127.0.0.1:8090/health doesn't answer"
ok "$name is up and stable"

pass "notification-service is out of its crash loop"
