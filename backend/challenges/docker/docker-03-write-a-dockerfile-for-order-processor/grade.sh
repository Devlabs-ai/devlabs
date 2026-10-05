#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"
trap grade_cleanup EXIT

dir=/home/learner/order-processor
image=quickbyte/order-processor:1.3
run=op-13

wait_docker

box_ok "test -f $dir/Dockerfile" || fail "$dir/Dockerfile does not exist"
image_exists "$image" || fail "no image $image (docker build -t $image ~/order-processor)"
ok "image $image built"

base="$(inspect python:3.12-slim '{{join .RootFS.Layers " "}}')"
layers="$(inspect "$image" '{{join .RootFS.Layers " "}}')"
[[ -n "$base" && "$layers" == "$base"* ]] || fail "$image must be built FROM python:3.12-slim"
[[ "$(inspect "$image" '{{.Config.WorkingDir}}')" == /app ]] || fail "set WORKDIR /app"
[[ "$(container_env "$image" APP_VERSION)" == v1.3 ]] || fail "set ENV APP_VERSION=v1.3 in the image"
inspect "$image" '{{range $p, $_ := .Config.ExposedPorts}}{{println $p}}{{end}}' | grep -qx 8000/tcp \
  || fail "document the app's port with EXPOSE 8000"
cmd="$(inspect "$image" '{{json .Config.Entrypoint}} {{json .Config.Cmd}}')"
[[ "$cmd" == *gunicorn* ]] || fail "the image's command must start gunicorn (CMD)"
[[ "$cmd" != *'"/bin/sh","-c"'* ]] \
  || fail "write CMD in exec form, CMD [\"gunicorn\", ...]: shell form wraps the app in /bin/sh, which doesn't pass on docker stop's SIGTERM"
ok "base, workdir, env, port and exec-form CMD"

dk_ok run --rm --entrypoint python "$image" -c 'import flask, gunicorn' \
  || fail "flask and gunicorn are not installed in the image (pip install --no-index --find-links=wheels -r requirements.txt)"
dk_ok run -d --name dl-grade-op13 -p 127.0.0.1:18081:8000 "$image" \
  || fail "a container from $image did not start"
version="$(box_json http://127.0.0.1:18081/health .version)" \
  || fail "a fresh container from $image does not answer /health on port 8000 (docker logs on your op-13)"
[[ "$version" == v1.3 ]] || fail "/health reports $version; expected v1.3"
ok "a fresh container from $image serves /health"

container_exists "$run" || fail "no container named $run"
[[ "$(container_state "$run")" == running ]] || fail "$run is not running (docker logs $run)"
[[ "$(inspect "$run" '{{.Image}}')" == "$(inspect "$image" '{{.Id}}')" ]] \
  || fail "$run is not running the latest build of $image (rebuilt after starting it? remove and run it again)"
[[ "$(published_port "$run" 8000)" == 8081 ]] || fail "publish $run's port 8000 on host port 8081"
[[ "$(box_json http://127.0.0.1:8081/health .version)" == v1.3 ]] || fail "http://127.0.0.1:8081/health does not report v1.3"
ok "$run serves v1.3 on 8081"

pass "order-processor has a Dockerfile and a working 1.3 image"
