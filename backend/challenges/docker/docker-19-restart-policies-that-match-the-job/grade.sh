#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

policy() { inspect "$1" '{{.HostConfig.RestartPolicy.Name}}:{{.HostConfig.RestartPolicy.MaximumRetryCount}}'; }

wait_docker

for c in order-processor order-sync notification-service; do
  container_exists "$c" || fail "no container named $c"
done
[[ "$(inspect order-processor '{{.Config.Image}}')" == devsetu/order-processor:v1.2 ]] || fail "order-processor must run devsetu/order-processor:v1.2"
[[ "$(inspect order-sync '{{.Config.Image}}')" == quickbyte/order-sync:1.0 ]] || fail "order-sync must run quickbyte/order-sync:1.0"
[[ "$(inspect notification-service '{{.Config.Image}}')" == devsetu/notification-service:v1.1 ]] \
  || fail "notification-service must run devsetu/notification-service:v1.1"

[[ "$(policy order-processor)" == unless-stopped:0 ]] || fail "order-processor needs --restart unless-stopped (it has $(policy order-processor))"
[[ "$(policy order-sync)" == on-failure:3 ]] || fail "order-sync needs --restart on-failure:3: retry a failing job 3 times, then give up (it has $(policy order-sync))"
[[ "$(policy notification-service)" == unless-stopped:0 ]] || fail "notification-service needs --restart unless-stopped"
ok "restart policies"

for _ in $(seq 60); do
  [[ "$(inspect order-sync '{{.State.Status}} {{.RestartCount}}')" == "exited 3" ]] && break
  sleep 1
done
[[ "$(inspect order-sync '{{.State.Status}} {{.RestartCount}} {{.State.ExitCode}}')" == "exited 3 1" ]] \
  || fail "order-sync should have been retried 3 times and then stay exited with code 1 (it is $(inspect order-sync '{{.State.Status}}, restarted {{.RestartCount}} times'))"
ok "order-sync retried 3 times, then gave up"

[[ "$(container_state order-processor)" == running ]] || fail "order-processor is not running"
[[ "$(container_state notification-service)" == exited ]] \
  || fail "stop notification-service (docker stop): it's paused for maintenance"
ok "order-processor running, notification-service stopped"

# A daemon restart is what a host reboot looks like to containers.
in_box 'systemctl restart docker' || fail "could not restart Docker"
wait_docker
for _ in $(seq 30); do [[ "$(container_state order-processor)" == running ]] && break; sleep 1; done
[[ "$(container_state order-processor)" == running ]] || fail "order-processor didn't come back after Docker restarted"
[[ "$(container_state notification-service)" == exited ]] \
  || fail "notification-service came back after Docker restarted; it was stopped on purpose"
[[ "$(container_state order-sync)" == exited ]] || fail "order-sync came back after Docker restarted"
ok "after a Docker restart: order-processor back, the stopped service stayed stopped"

pass "each container restarts the way its job needs"
