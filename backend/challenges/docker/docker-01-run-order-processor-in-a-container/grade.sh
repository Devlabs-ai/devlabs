#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

name=order-processor
image=devsetu/order-processor:v1.1

wait_docker

container_exists "$name" || fail "no container named $name"
[[ "$(inspect "$name" '{{.Config.Image}}')" == "$image" ]] \
  || fail "$name runs $(inspect "$name" '{{.Config.Image}}'); it must run $image (remove the old one first: docker rm)"
state="$(container_state "$name")"
[[ "$state" == running ]] || fail "$name is $state, not running (docker logs $name)"
ok "$name runs $image"

port="$(published_port "$name" 8000)"
[[ "$port" == 8080 ]] || fail "container port 8000 must be published on host port 8080 (-p 8080:8000)${port:+; it is on $port}"
[[ "$(container_env "$name" LOG_LEVEL)" == DEBUG ]] || fail "set LOG_LEVEL=DEBUG in the container's environment (-e)"
version="$(box_json http://127.0.0.1:8080/health .version)" \
  || fail "GET http://127.0.0.1:8080/health failed from the order box"
[[ "$version" == v1.1 ]] || fail "/health reports version $version; expected v1.1"
ok "published on 8080 with LOG_LEVEL=DEBUG"

need_answer order-id "the order_id returned by POST /orders"
id="$(answer order-id)"
[[ "$id" =~ ^ORD-[0-9A-F]{8}$ ]] || fail "~/answers/order-id should hold just the order_id, like ORD-1A2B3C4D"
logs="$(dk logs "$name" 2>&1)"
grep -q "created $id" <<<"$logs" \
  || fail "$id was not created by this container (place the order against http://127.0.0.1:8080/orders)"
ok "order $id placed"

need_answer app-user "the user the app process runs as inside the container"
[[ "$(answer app-user)" == "$(dk exec "$name" id -un)" ]] \
  || fail "~/answers/app-user is not the user the app runs as inside the container (docker exec $name ...)"
ok "app user"

pass "order-processor v1.1 runs in a container and takes orders"
