#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker

need_answer biggest-volume "the unused volume using the most space"
[[ "$(answer biggest-volume)" == "$(in_box 'cat /root/.lab/big-volume')" ]] \
  || fail "~/answers/biggest-volume is not the biggest volume (docker system df -v)"
ok "biggest volume identified"

[[ "$(container_state order-processor)" == running ]] || fail "order-processor must keep running"
image_exists devsetu/order-processor:v1.2 || fail "devsetu/order-processor:v1.2 is in use; it must stay"
dk_ok volume inspect orders-backup || fail "orders-backup is gone: it held the only backup of the orders database"
[[ "$(dk run --rm -v orders-backup:/data alpine:3.20 md5sum /data/orders-2026-10-01.sql.gz 2>/dev/null | cut -d' ' -f1)" \
  == "$(in_box 'cat /root/.lab/backup-md5')" ]] || fail "the backup file in orders-backup was changed or deleted"
ok "order-processor, its image and orders-backup are intact"

stopped="$(dk ps -aq --filter status=exited --filter status=created)"
[[ -z "$stopped" ]] || fail "remove the stopped containers (docker container prune)"
[[ -z "$(dk images -q --filter dangling=true)" ]] || fail "remove the dangling images (docker image prune)"
vols="$(dk volume ls -q | sort | tr '\n' ' ')"
[[ "$vols" == "orders-backup " ]] \
  || fail "remove every unused volume except orders-backup (docker volume prune -a only removes named volumes with -a; filter by label to keep it). Left: $vols"
cache="$(in_box "docker system df --format json | jq -r 'select(.Type == \"Build Cache\") | .Size'")"
[[ "$cache" == 0B ]] || fail "clear the build cache (docker builder prune); it holds $cache"
ok "stopped containers, dangling images, unused volumes and build cache cleared"

pass "Docker's leftovers are gone and nothing important went with them"
