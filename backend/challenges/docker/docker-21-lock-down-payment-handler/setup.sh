#!/usr/bin/env bash
# payment-handler running the way it was "made to work": as root, extra capabilities,
# writable root filesystem, published on every interface.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull devsetu/payment-handler:v1.1

box_script <<'EOF'
docker rm -f payment-handler >/dev/null 2>&1 || true
docker run -d --name payment-handler --user 0 --cap-add NET_ADMIN --cap-add SYS_PTRACE \
  -p 8001:8000 devsetu/payment-handler:v1.1 >/dev/null
EOF
fresh_answers
ok "payment-handler is running"
