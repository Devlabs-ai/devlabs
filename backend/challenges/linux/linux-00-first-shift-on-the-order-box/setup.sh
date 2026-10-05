#!/usr/bin/env bash
# Seeds the order box: an installed order-processor (release marker, config, logs)
# with per-session values, so answers cannot be copied between learners.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

version="1.$((RANDOM % 8 + 2)).$((RANDOM % 10))"
port="$((8000 + RANDOM % 900))"
big="orders-2026-09-$(printf '%02d' $((RANDOM % 28 + 1))).log"

box_script <<EOF
install -d -m 755 /opt/order-processor/bin /etc/order-processor /var/log/order-processor
printf '%s\n' '#!/bin/sh' 'echo "order-processor $version"' > /opt/order-processor/bin/order-processor
chmod 755 /opt/order-processor/bin/order-processor
echo "$version" > /opt/order-processor/.release

cat > /etc/order-processor/app.conf <<'CONF'
# order-processor configuration
[server]
host = 0.0.0.0
port = $port

[queue]
url = amqp://queue.internal:5672
prefetch = 20
CONF

cd /var/log/order-processor
rm -f ./*.log
for d in 03 07 11 15 19 23; do
  f="orders-2026-09-\$d.log"
  for i in \$(seq 1 \$((RANDOM % 40 + 20))); do
    echo "2026-09-\$d 10:\$((i % 60)):00 INFO order \$((RANDOM)) accepted"
  done > "\$f"
done
for i in \$(seq 1 600); do
  echo "2026-09-xx 11:\$((i % 60)):00 WARN order \$((RANDOM)) retried: payment timeout"
done > "$big"
chmod 644 ./*.log

rm -rf /home/learner/notes
EOF
ok "order box seeded"
