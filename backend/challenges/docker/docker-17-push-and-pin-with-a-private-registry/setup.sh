#!/usr/bin/env bash
# The registry image and order-processor v1.2 pre-pulled; nothing running.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull registry:3 devsetu/order-processor:v1.2

box_script <<'EOF'
docker rm -f registry op-pinned >/dev/null 2>&1 || true
docker volume rm registry-data >/dev/null 2>&1 || true
EOF
fresh_answers
ok "order box ready"
