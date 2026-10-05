#!/usr/bin/env bash
# Drops a messy release upload into ~/incoming.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_script <<'EOF'
rm -rf /home/learner/incoming /home/learner/release
install -d -o learner -g learner /home/learner/incoming /home/learner/incoming/old
cd /home/learner/incoming
printf '%s\n' '#!/bin/sh' 'echo "order-processor v1.3"' > order-processor
chmod 755 order-processor
printf 'port = 8080\nlog_level = info\n' > order-processor.conf
printf 'queue = amqp://queue.internal:5672\n' > queue.conf
printf 'gateway = https://gateway.example-pay.test\n' > 'payment handler.conf'
for d in 28 29 30; do
  printf '2026-09-%s 10:00:00 INFO order accepted\n' "$d" > "orders-2026-09-$d.log"
done
printf 'Release notes for order-processor v1.3\n' > README
printf 'scratch\n' > build-1.tmp
printf 'scratch\n' > build-2.tmp
printf 'scratch\n' > upload.tmp
chown -R learner:learner /home/learner/incoming
EOF
ok "release upload seeded in ~/incoming"
