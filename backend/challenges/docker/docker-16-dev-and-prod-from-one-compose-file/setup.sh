#!/usr/bin/env bash
# ~/order-stack/compose.yaml: the shared base everyone runs today.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull devsetu/order-processor:v1.2 devsetu/payment-handler:v1.1 alpine:3.20

box_script <<'EOF'
rm -rf /home/learner/order-stack
install -d -o learner -g learner /home/learner/order-stack
cat > /home/learner/order-stack/compose.yaml <<'YAML'
services:
  payment-handler:
    image: devsetu/payment-handler:v1.1
    restart: unless-stopped

  order-processor:
    image: devsetu/order-processor:v1.2
    restart: unless-stopped
    ports:
      - "8080:8000"
    environment:
      LOG_LEVEL: INFO
      MIN_ORDER_VALUE: "10"
    depends_on:
      - payment-handler
YAML
chown learner:learner /home/learner/order-stack/compose.yaml
EOF
fresh_answers
ok "~/order-stack ready"
