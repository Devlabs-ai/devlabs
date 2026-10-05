#!/usr/bin/env bash
# Leaves a stale, never-started order-processor v1.0 container holding the name the
# learner needs; they pull v1.1 themselves.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull devsetu/order-processor:v1.0

box_script <<'EOF'
docker rm -f order-processor >/dev/null 2>&1 || true
docker rmi -f devsetu/order-processor:v1.1 >/dev/null 2>&1 || true
docker create --name order-processor -p 8080:8000 devsetu/order-processor:v1.0 >/dev/null
rm -rf /home/learner/answers
EOF
fresh_answers
ok "order box ready"
