#!/usr/bin/env bash
# order-processor and payment-handler on the default bridge, where containers can only
# reach each other by IP.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull devsetu/order-processor:v1.2 devsetu/payment-handler:v1.1 devsetu/notification-service:v1.1

box_script <<'EOF'
docker rm -f order-processor payment-handler notification-service >/dev/null 2>&1 || true
docker network rm quickbyte-net >/dev/null 2>&1 || true
docker run -d --name payment-handler devsetu/payment-handler:v1.1 >/dev/null
docker run -d --name order-processor -p 8080:8000 devsetu/order-processor:v1.2 >/dev/null
EOF
fresh_answers
ok "order-processor and payment-handler are running"
