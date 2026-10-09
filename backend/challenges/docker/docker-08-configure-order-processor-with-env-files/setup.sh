#!/usr/bin/env bash
# Ops' env file for order-processor, with per-session limits. MIN_ORDER_VALUE is quoted
# the way a shell file would be; docker --env-file passes the quotes through literally.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

min=$((RANDOM % 31 + 15))
max=$((RANDOM % 6 + 3))
key="pk_live_$(printf '%04x%04x%04x' $RANDOM $RANDOM $RANDOM)"

wait_docker
prepull devsetu/order-processor:v1.2

box_script <<EOF
rm -rf /home/learner/config
install -d -o learner -g learner /home/learner/config
cat > /home/learner/config/order-processor.env <<'ENV'
# order-processor — production settings (owned by ops)
MIN_ORDER_VALUE="$min"
MAX_ITEMS_PER_ORDER=$max
LOG_LEVEL=INFO
PAYMENT_API_KEY=$key
ENV
chown learner:learner /home/learner/config/order-processor.env
chmod 600 /home/learner/config/order-processor.env
install -d -m 700 /root/.lab
printf '%s %s %s\n' $min $max $key > /root/.lab/env
EOF
fresh_answers
ok "~/config/order-processor.env ready"
