#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"
cleanup_404() {
  in_box 'rm -rf /tmp/dl-grade-ctx; docker rmi -f dl-grade-cache:1 >/dev/null 2>&1; true' >/dev/null 2>&1 || true
}
trap cleanup_404 EXIT

src=/home/learner/order-processor
image=quickbyte/order-processor:1.5

wait_docker

box_ok "test -f $src/.dockerignore" || fail "$src/.dockerignore does not exist"
for p in .git .env logs; do
  box_ok "grep -Eq '^/?${p//./\\.}/?(\\*\\*)?\$' $src/.dockerignore" \
    || fail ".dockerignore must exclude $p"
done
ok ".dockerignore"

image_exists "$image" || fail "no image $image (docker build -t $image ~/order-processor)"
[[ "$(container_env "$image" APP_VERSION)" == v1.5 ]] || fail "$image must have APP_VERSION=v1.5"
listing="$(dk run --rm --entrypoint ls "$image" -A /app | sort | tr '\n' ' ')"
[[ "$listing" == "app.py requirements.txt " ]] \
  || fail "/app in $image should hold only app.py and requirements.txt; it has: $listing"
dk run --rm --entrypoint python "$image" -c 'import flask, gunicorn' >/dev/null 2>&1 \
  || fail "flask and gunicorn are not installed in $image"
ok "image holds only what the app needs"

# Rebuild a copy with only app.py changed: the dependency install must come from cache.
in_box "rm -rf /tmp/dl-grade-ctx && cp -a $src /tmp/dl-grade-ctx" || fail "could not copy $src"
in_box "docker build -q -t dl-grade-cache:1 /tmp/dl-grade-ctx" >/dev/null 2>&1 \
  || fail "docker build ~/order-processor fails"
in_box "echo '# touched by the grader' >> /tmp/dl-grade-ctx/app.py"
out="$(in_box "docker build --progress=plain -t dl-grade-cache:1 /tmp/dl-grade-ctx 2>&1")" \
  || fail "the rebuild after changing app.py failed"
step="$(grep -E '^#[0-9]+ \[[^]]+\] RUN .*pip install' <<<"$out" | head -n1 | cut -d' ' -f1)"
[[ -n "$step" ]] || fail "no RUN pip install step found in the build"
grep -qx "$step CACHED" <<<"$out" \
  || fail "changing only app.py re-ran pip install: copy requirements.txt and install dependencies before COPY app.py"
ok "changing app.py doesn't reinstall dependencies"

pass "rebuilds are fast and the image carries no junk or secrets"
