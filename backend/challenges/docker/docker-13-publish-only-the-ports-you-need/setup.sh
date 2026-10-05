#!/usr/bin/env bash
# The order services on orders-net, every one of them published on all interfaces.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull devsetu/order-processor:v1.2 devsetu/payment-handler:v1.1 devsetu/notification-service:v1.1

box_script <<'EOF'
docker rm -f order-processor payment-handler notification-service >/dev/null 2>&1 || true
docker network rm orders-net >/dev/null 2>&1 || true
docker network create orders-net >/dev/null
docker run -d --name payment-handler --network orders-net -p 8000:8000 devsetu/payment-handler:v1.1 >/dev/null
docker run -d --name notification-service --network orders-net -p 8090:8080 devsetu/notification-service:v1.1 >/dev/null
docker run -d --name order-processor --network orders-net -p 8080:8000 devsetu/order-processor:v1.2 >/dev/null
EOF
fresh_answers
ok "the order services are running"
