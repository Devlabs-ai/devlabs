#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

repo=quickbyte/order-processor
ref=localhost:5000/$repo
accept='application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json'

wait_docker

container_exists registry || fail "no container named registry"
[[ "$(inspect registry '{{.Config.Image}}')" == registry:3 ]] || fail "registry must run the registry:3 image"
[[ "$(container_state registry)" == running ]] || fail "registry is not running (docker logs registry)"
[[ "$(inspect registry '{{.HostConfig.RestartPolicy.Name}}')" == unless-stopped ]] || fail "registry needs --restart unless-stopped"
[[ "$(published_port registry 5000)" == 5000 ]] || fail "publish the registry's port 5000 on host port 5000"
mount="$(inspect_jq registry '.Mounts[] | select(.Destination == "/var/lib/registry") | "\(.Type) \(.Name)"')"
[[ "$mount" == "volume registry-data" ]] || fail "keep the registry's storage (/var/lib/registry) on the named volume registry-data"
ok "registry running on localhost:5000 with storage on registry-data"

tags="$(box_json "http://127.0.0.1:5000/v2/$repo/tags/list" '.tags // [] | join(" ")' || true)"
for t in 1.2 stable; do
  [[ " $tags " == *" $t "* ]] || fail "$ref:$t is not in the registry (docker tag, then docker push); tags there: ${tags:-none}"
done
ok "pushed $repo with tags: $tags"

digest_of() {
  in_box "curl -fsSI -H 'Accept: $accept' http://127.0.0.1:5000/v2/$repo/manifests/$1 | tr -d '\r' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: //p'"
}
d12="$(digest_of 1.2)"
[[ "$(digest_of stable)" == "$d12" ]] || fail "stable must point at the same image as 1.2"
need_answer digest "the digest of $ref:1.2"
[[ "$(answer digest)" == "$d12" ]] || fail "~/answers/digest is not the registry digest of 1.2 (sha256:..., shown by docker push or docker inspect RepoDigests)"
ok "digest $d12"

container_exists op-pinned || fail "no container named op-pinned"
[[ "$(inspect op-pinned '{{.Config.Image}}')" == "$ref@$d12" ]] \
  || fail "op-pinned must be started from $ref@$d12 (by digest, not by tag)"
[[ "$(container_state op-pinned)" == running ]] || fail "op-pinned is not running"
[[ "$(published_port op-pinned 8000)" == 8087 ]] || fail "publish op-pinned's port 8000 on host port 8087"
[[ "$(box_json http://127.0.0.1:8087/health .status)" == ok ]] || fail "http://127.0.0.1:8087/health doesn't answer"
ok "op-pinned runs the exact image by digest"

pass "order-processor is published to the private registry and deployed by digest"
