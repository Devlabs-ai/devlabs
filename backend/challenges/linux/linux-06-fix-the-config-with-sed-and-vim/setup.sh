#!/usr/bin/env bash
# An order-processor config still pointing at the old queue cluster, with debug logging
# and leftover TODOs. A pristine copy is kept (root-only) to grade the backup against.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_script <<'EOF'
install -d -m 755 /etc/order-processor
install -d -m 700 /var/lib/devlabs
cat > /var/lib/devlabs/app.conf.orig <<'CONF'
# order-processor configuration
[server]
host = 0.0.0.0
port = 8080
log_level = debug
# TODO remove debug logging before go-live
#metrics_port = 9100

[queue]
url = amqp://queue-old.internal:5672
fallback = amqp://queue-old.internal:5673
prefetch = 20
# TODO tune prefetch after load test

[payments]
endpoint = http://payment-old.internal:9090
timeout = 5s
CONF
cp /var/lib/devlabs/app.conf.orig /etc/order-processor/app.conf
chmod 644 /etc/order-processor/app.conf
rm -f /etc/order-processor/app.conf.bak
EOF
ok "app.conf seeded"
