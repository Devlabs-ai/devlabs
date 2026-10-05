#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

good=quickbyte/order-processor:1.7

wait_docker

need_answer broken-version "the release that broke order-processor"
[[ "$(answer broken-version)" =~ ^v?1\.8$ ]] || fail "~/answers/broken-version is not the broken release"
need_answer listen-address "the address:port the broken release listens on"
[[ "$(answer listen-address | sed 's#^http://##')" == 127.0.0.1:8000 ]] \
  || fail "~/answers/listen-address is not where the broken release's gunicorn listens (docker logs)"
ok "found the broken release and why"

image_exists "$good" || fail "$good is gone; don't delete the last good release"
image_exists quickbyte/order-processor:1.8 || fail "keep quickbyte/order-processor:1.8 for the post-mortem"
container_exists order-processor || fail "no container named order-processor"
[[ "$(inspect order-processor '{{.Config.Image}}')" == "$good" ]] \
  || fail "run order-processor from $good, by its version tag (it runs $(inspect order-processor '{{.Config.Image}}'))"
[[ "$(container_state order-processor)" == running ]] || fail "order-processor is not running"
[[ "$(inspect order-processor '{{.HostConfig.RestartPolicy.Name}}')" == unless-stopped ]] || fail "keep --restart unless-stopped"
[[ "$(published_port order-processor 8000)" == 8080 ]] || fail "publish order-processor on 8080"
[[ "$(box_json http://127.0.0.1:8080/health .version)" == v1.7 ]] || fail "http://127.0.0.1:8080/health doesn't report v1.7"
ok "order-processor rolled back to 1.7"

[[ "$(inspect quickbyte/order-processor:latest '{{.Id}}')" == "$(inspect "$good" '{{.Id}}')" ]] \
  || fail "quickbyte/order-processor:latest still points at the broken image; point it back at 1.7 (docker tag)"
ok "latest points at 1.7 again"

pass "order-processor is back on the last good release"
