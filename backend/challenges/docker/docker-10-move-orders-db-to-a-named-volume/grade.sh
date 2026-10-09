#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

name=orders-db
data=/var/lib/postgresql/data
read -r count marker <<<"$(in_box 'cat /root/.lab/orders')"

wait_docker

need_answer order-count "how many orders the database holds"
[[ "$(answer order-count)" == "$count" ]] || fail "~/answers/order-count is not the number of rows in the orders table"
ok "order count"

dk_ok volume inspect orders-data || fail "no volume named orders-data (docker volume create orders-data)"
container_exists "$name" || fail "no container named $name"
[[ "$(inspect "$name" '{{.Config.Image}}')" == postgres:16-alpine ]] || fail "$name must run postgres:16-alpine"
[[ "$(container_state "$name")" == running ]] || fail "$name is not running (docker logs $name)"
mount="$(inspect_jq "$name" ".Mounts[] | select(.Destination == \"$data\") | \"\(.Type) \(.Name)\"")"
[[ "$mount" == "volume orders-data" ]] \
  || fail "$name must keep $data on the named volume orders-data (-v orders-data:$data); it has: ${mount:-nothing}"
ok "$name keeps its data on orders-data"

q() { dk exec "$name" psql -tA -U orders -d orders -c "$1" 2>/dev/null; }
for _ in $(seq 20); do q 'SELECT 1' >/dev/null && break; sleep 1; done
got="$(q 'SELECT count(*) FROM orders' || true)"
[[ "$got" == "$count" ]] || fail "$name has ${got:-no} orders; the original $count must survive the move"
[[ "$(q "SELECT customer_id FROM orders WHERE order_id = '$marker'" || true)" == c-42 ]] \
  || fail "order $marker is missing: the data must be moved, not recreated"
ok "all $count orders survived"

others="$(dk volume ls -q | grep -vx orders-data || true)"
[[ -z "$others" ]] || fail "remove the old anonymous volume once the data is moved (docker volume ls; docker volume rm ...)"
ok "old anonymous volume removed"

pass "the orders database lives on a named volume"
