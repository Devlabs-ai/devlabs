#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"
trap 'in_box "docker rm -f dl-grade-logs >/dev/null 2>&1; true" >/dev/null 2>&1 || true' EXIT

conf=/etc/docker/daemon.json

wait_docker

need_answer chatty-log-path "where notifier-chatty's log file lives on the box"
[[ "$(answer chatty-log-path)" == "$(in_box 'cat /root/.lab/log-path')" ]] \
  || fail "~/answers/chatty-log-path is not notifier-chatty's log file (docker inspect -f '{{.LogPath}}')"
! container_exists notifier-chatty || fail "remove notifier-chatty (and its 40 MB log with it)"
ok "found and removed the chatty container's log"

box_ok "jq -e . $conf" || fail "$conf is not valid JSON (jq . $conf)"
[[ "$(in_box "jq -c '.\"registry-mirrors\"' $conf")" == "$(in_box 'cat /root/.lab/mirrors')" ]] \
  || fail "keep the existing settings in $conf (registry-mirrors went missing or changed)"
[[ "$(in_box "jq -r '.\"log-driver\" // \"json-file\"' $conf")" == json-file ]] || fail "keep the json-file log driver"
[[ "$(in_box "jq -r '.\"log-opts\".\"max-size\" // \"\"' $conf")" == 10m ]] || fail "set log-opts max-size to \"10m\" in $conf"
[[ "$(in_box "jq -r '.\"log-opts\".\"max-file\" // \"\"' $conf")" == 3 ]] || fail "set log-opts max-file to \"3\" in $conf"
dk_ok create --name dl-grade-logs alpine:3.20 true || fail "could not create a test container"
[[ "$(inspect_jq dl-grade-logs '.HostConfig.LogConfig.Config | "\(."max-size") \(."max-file")"')" == "10m 3" ]] \
  || fail "new containers don't get max-size=10m max-file=3 yet: Docker reads daemon.json only when it starts (sudo systemctl restart docker)"
ok "daemon default: json-file, 10m x 3"

container_exists notifier || fail "no container named notifier"
[[ "$(inspect notifier '{{.Config.Image}}')" == devsetu/notification-service:v1.1 ]] || fail "notifier must run devsetu/notification-service:v1.1"
[[ "$(container_state notifier)" == running ]] \
  || fail "notifier is not running (a container without a restart policy stays down after Docker restarts)"
[[ "$(inspect notifier '{{.HostConfig.RestartPolicy.Name}}')" == unless-stopped ]] || fail "notifier needs --restart unless-stopped"
[[ "$(inspect_jq notifier '.HostConfig.LogConfig | "\(.Type) \(.Config."max-size") \(.Config."max-file")"')" == "json-file 5m 3" ]] \
  || fail "notifier must override the default with --log-opt max-size=5m --log-opt max-file=3"
ok "notifier logs capped at 5m x 3"

pass "container logs can no longer fill the disk"
