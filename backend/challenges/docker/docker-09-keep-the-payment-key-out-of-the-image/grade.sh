#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

dir=/home/learner/payments
secret=$dir/secrets/payment_api_key.txt
read -r old new <<<"$(in_box 'cat /root/.lab/keys')"

wait_docker

need_answer leaked-key "the API key baked into quickbyte/payment-handler:1.1-hotfix"
[[ "$(answer leaked-key)" == "$old" ]] \
  || fail "~/answers/leaked-key is not the key baked into the hotfix image (docker history --no-trunc, or docker image inspect)"
ok "found the leaked key"

! image_exists quickbyte/payment-handler:1.1-hotfix || fail "delete the image quickbyte/payment-handler:1.1-hotfix"
ok "hotfix image deleted"

[[ "$(in_box "stat -c %a $secret")" == 600 ]] || fail "$secret must be readable by its owner only (chmod 600)"
[[ "$(in_box "cat $secret")" == "$new" ]] || fail "keep the current key in $secret"
box_ok "grep -qF '$new' $dir/compose.yaml" && fail "compose.yaml still contains the key; reference the secret file instead"
cfg() { in_box "docker compose --project-directory $dir -f $dir/compose.yaml config --format json | jq -r '$1'"; }
cfg .name >/dev/null 2>&1 || fail "compose.yaml is not valid (cd ~/payments && docker compose config)"
[[ "$(cfg '.secrets.payment_api_key.file // ""')" == "$secret" ]] \
  || fail "declare a top-level secret payment_api_key with file: ./secrets/payment_api_key.txt"
cfg '.services["payment-handler"].secrets // [] | .[].source' | grep -qx payment_api_key \
  || fail "give the payment-handler service the payment_api_key secret"
ok "compose.yaml uses a file-based secret"

ph="$(compose_container payments payment-handler)"
[[ -n "$ph" && "$(container_state "$ph")" == running ]] \
  || fail "payment-handler is not running (cd ~/payments && docker compose up -d)"
[[ "$(inspect "$ph" '{{.Config.Image}}')" == devsetu/payment-handler:v1.1 ]] || fail "payment-handler must run devsetu/payment-handler:v1.1"
[[ "$(dk exec "$ph" cat /run/secrets/payment_api_key 2>/dev/null)" == "$new" ]] \
  || fail "payment-handler can't read the key at /run/secrets/payment_api_key"
insp="$(in_box "docker inspect $ph")"
grep -qF "$new" <<<"$insp" && fail "the key still shows up in docker inspect (remove PAYMENT_API_KEY from environment:)"
ok "the key is at /run/secrets/payment_api_key and nowhere in docker inspect"

pass "the payment key lives in a secret file, not in the image or the environment"
