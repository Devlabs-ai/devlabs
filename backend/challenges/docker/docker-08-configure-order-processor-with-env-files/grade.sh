#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

name=op-config
file=/home/learner/config/order-processor.env
read -r min max key <<<"$(in_box 'cat /root/.lab/env')"

wait_docker

container_exists "$name" || fail "no container named $name"
[[ "$(inspect "$name" '{{.Config.Image}}')" == devsetu/order-processor:v1.2 ]] || fail "$name must run devsetu/order-processor:v1.2"
[[ "$(container_state "$name")" == running ]] || fail "$name is not running (docker logs $name)"
[[ "$(published_port "$name" 8000)" == 8085 ]] || fail "publish $name's port 8000 on host port 8085"
ok "$name runs v1.2 on 8085"

[[ "$(container_env "$name" PAYMENT_API_KEY)" == "$key" ]] \
  || fail "$name doesn't have PAYMENT_API_KEY from the env file (--env-file ~/config/order-processor.env)"
[[ "$(container_env "$name" MAX_ITEMS_PER_ORDER)" == "$max" ]] || fail "$name doesn't have MAX_ITEMS_PER_ORDER=$max from the env file"
box_ok "grep -qx 'LOG_LEVEL=INFO' $file" || fail "leave LOG_LEVEL=INFO in the env file; override it for this container only"
[[ "$(container_env "$name" LOG_LEVEL)" == WARNING ]] || fail "$name must run with LOG_LEVEL=WARNING (override the file's value on the command line)"
ok "settings from the env file, LOG_LEVEL overridden"

got_min="$(container_env "$name" MIN_ORDER_VALUE)"
[[ "$got_min" == "$min" ]] \
  || fail "$name has MIN_ORDER_VALUE=$got_min, quotes included: docker --env-file takes values literally, so the app can't parse it (it then accepts every order)"
code="$(http_code POST http://127.0.0.1:8085/orders "{\"items\":[\"chai\"],\"total\":$((min - 1))}")"
[[ "$code" == 400 ]] || fail "an order of $((min - 1)) should be rejected (minimum $min); got HTTP $code"
items="$(printf '"x",%.0s' $(seq "$((max + 1))"))"
code="$(http_code POST http://127.0.0.1:8085/orders "{\"items\":[${items%,}],\"total\":$((min + 10))}")"
[[ "$code" == 400 ]] || fail "an order with $((max + 1)) items should be rejected (maximum $max); got HTTP $code"
code="$(http_code POST http://127.0.0.1:8085/orders "{\"items\":[\"chai\"],\"total\":$((min + 10))}")"
[[ "$code" == 201 ]] || fail "a normal order should be accepted; got HTTP $code"
ok "orders follow MIN_ORDER_VALUE=$min and MAX_ITEMS_PER_ORDER=$max"

pass "order-processor takes its settings from the env file"
