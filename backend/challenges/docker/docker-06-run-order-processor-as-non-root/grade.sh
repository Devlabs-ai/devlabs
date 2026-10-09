#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"
trap grade_cleanup EXIT

image=quickbyte/order-processor:1.6
run=op-16
uid=10001

wait_docker

image_exists "$image" || fail "no image $image (docker build -t $image ~/order-processor)"
[[ "$(container_env "$image" APP_VERSION)" == v1.6 ]] || fail "$image must have APP_VERSION=v1.6"
user="$(inspect "$image" '{{.Config.User}}')"
[[ "$user" =~ ^$uid(:[0-9]+)?$ ]] \
  || fail "the image's USER must be the numeric UID $uid (got '${user:-root}'); Kubernetes' runAsNonRoot can only verify numeric users"
ok "USER $user"

ent="$(dk run --rm --entrypoint getent "$image" passwd orders 2>/dev/null || true)"
[[ "$ent" == "orders:x:$uid:"* ]] || fail "the image needs a user orders with UID $uid (useradd --uid $uid ...)"
shell="${ent##*:}"
[[ "$shell" == */nologin || "$shell" == */false ]] || fail "user orders should have no login shell (/usr/sbin/nologin), it has $shell"
ok "user orders ($uid), no login shell"

dk_ok run --rm --entrypoint sh "$image" -c 'test ! -w /app/app.py && test ! -w /app' \
  || fail "the app user can modify /app; leave the code owned by root so a compromised app can't rewrite itself"
ok "code is read-only for the app user"

dk_ok run -d --name dl-grade-op16 "$image" || fail "a container from $image did not start"
sleep 3
ps_user="$(dk exec dl-grade-op16 sh -c 'id -u')"
[[ "$ps_user" == "$uid" ]] || fail "processes in $image run as UID $ps_user, not $uid"
reply="$(dk exec dl-grade-op16 python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).read().decode())" 2>&1 || true)"
[[ "$reply" == *'"version":"v1.6"'* ]] || fail "a fresh container from $image doesn't serve /health (docker logs): $reply"
ok "the app runs as $uid and serves /health"

container_exists "$run" || fail "no container named $run"
[[ "$(inspect "$run" '{{.Image}}')" == "$(inspect "$image" '{{.Id}}')" ]] \
  || fail "$run is not running the latest build of $image (remove and run it again)"
[[ "$(container_state "$run")" == running ]] || fail "$run is not running (docker logs $run)"
[[ "$(published_port "$run" 8000)" == 8084 ]] || fail "publish $run's port 8000 on host port 8084"
[[ "$(box_json http://127.0.0.1:8084/health .version)" == v1.6 ]] || fail "http://127.0.0.1:8084/health doesn't report v1.6"
ok "$run serves v1.6 on 8084"

pass "order-processor runs as an unprivileged user"
