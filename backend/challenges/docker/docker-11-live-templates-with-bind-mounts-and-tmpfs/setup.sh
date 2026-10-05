#!/usr/bin/env bash
# ~/notify/templates: notification templates the content team edits on the box.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

token="T-$(printf '%04X' $RANDOM)"

wait_docker
prepull nginx:1.27-alpine

box_script <<EOF
docker rm -f notify-preview >/dev/null 2>&1 || true
rm -rf /home/learner/notify
install -d -o learner -g learner /home/learner/notify /home/learner/notify/templates
cd /home/learner/notify/templates
printf 'Hi {{name}}, your order {{order_id}} is confirmed. Total: {{total}}. [$token]\n' > order-confirmed.txt
printf 'Good news {{name}}: order {{order_id}} is on its way.\n' > order-shipped.txt
printf 'Hi {{name}}, the payment for {{order_id}} failed. Please retry.\n' > payment-failed.txt
chown -R learner:learner /home/learner/notify
EOF
fresh_answers
ok "~/notify/templates ready"
