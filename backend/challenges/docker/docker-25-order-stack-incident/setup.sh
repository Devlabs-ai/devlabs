#!/usr/bin/env bash
# The order stack after a bad Friday deploy. compose.yaml has three problems (a payment
# image tag that doesn't exist, payment-handler on a network order-processor isn't on, a
# notification healthcheck probing the wrong port), and a forgotten debug container holds
# port 8080.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

min=$((RANDOM % 31 + 10))

wait_docker
prepull devsetu/order-processor:v1.2 devsetu/payment-handler:v1.1 devsetu/notification-service:v1.1 nginx:1.27-alpine

box_script <<EOF
docker rm -f debug-nginx >/dev/null 2>&1 || true
rm -rf /home/learner/order-stack
install -d -o learner -g learner /home/learner/order-stack
cd /home/learner/order-stack
cat > order-processor.env <<'ENV'
MIN_ORDER_VALUE=$min
LOG_LEVEL=INFO
ENV
cat > compose.yaml <<'YAML'
services:
  payment-handler:
    image: devsetu/payment-handler:v1.3
    restart: unless-stopped
    networks: [payments-net]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
      interval: 5s
      timeout: 3s
      retries: 3

  notification-service:
    image: devsetu/notification-service:v1.1
    restart: unless-stopped
    networks: [orders-net]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
      interval: 5s
      timeout: 3s
      retries: 3

  order-processor:
    image: devsetu/order-processor:v1.2
    restart: unless-stopped
    ports:
      - "8080:8000"
    env_file: order-processor.env
    networks: [orders-net]
    depends_on:
      payment-handler:
        condition: service_healthy
      notification-service:
        condition: service_healthy

networks:
  orders-net:
  payments-net:
YAML
cat > INCIDENT.txt <<'TXT'
INC-2041  order stack down after Friday deploy
- customers get connection errors on :8080
- payment-handler runs v1.1 in production (release notes: v1.2 and v1.3 never shipped)
- notification-service listens on 8080 inside its container
- someone was "debugging something with nginx" on this box last week
TXT
chown -R learner:learner /home/learner/order-stack
docker run -d --name debug-nginx --restart always -p 8080:80 nginx:1.27-alpine >/dev/null
install -d -m 700 /root/.lab
echo $min > /root/.lab/min
EOF
fresh_answers
ok "INC-2041 is open"
