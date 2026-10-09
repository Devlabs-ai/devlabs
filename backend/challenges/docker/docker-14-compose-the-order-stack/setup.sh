#!/usr/bin/env bash
# ~/order-stack with order-processor's env file (per-session minimum order value and
# API key); both images pre-pulled.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

min="$((RANDOM % 31 + 10))"
key="pk_test_$(printf '%04x%04x' $RANDOM $RANDOM)"

wait_docker
prepull devsetu/order-processor:v1.2 devsetu/payment-handler:v1.1

box_script <<EOF
rm -rf /home/learner/order-stack /home/learner/answers
install -d -o learner -g learner /home/learner/order-stack
cat > /home/learner/order-stack/order-processor.env <<'ENV'
# order-processor settings (ops-owned; don't copy into compose.yaml)
MIN_ORDER_VALUE=$min
LOG_LEVEL=INFO
PAYMENT_API_KEY=$key
ENV
chown learner:learner /home/learner/order-stack/order-processor.env
chmod 600 /home/learner/order-stack/order-processor.env
EOF
fresh_answers
ok "~/order-stack ready"
