#!/usr/bin/env bash
# Releases v1.1 and v1.2 on disk with `current` pointing at the bad v1.2, plus a tarball
# backup of v1.0.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_script <<'EOF'
R=/opt/order-processor/releases
rm -rf /opt/order-processor /var/backups/order-processor-* /var/backups/app.conf.* /etc/order-processor
install -d "$R" /var/backups /etc/order-processor
mkrel() {
  install -d "$R/$1/bin"
  echo "$1" | tr -d v > "$R/$1/VERSION"
  printf '%s\n' '#!/bin/sh' "echo \"order-processor $1\"" > "$R/$1/bin/order-processor"
  chmod 755 "$R/$1/bin/order-processor"
  printf 'version = %s\nqueue = amqp://queue.internal:5672\n' "$1" > "$R/$1/app.conf"
}
mkrel v1.0
tar -C "$R" -czf /var/backups/order-processor-v1.0.tar.gz v1.0
rm -rf "$R/v1.0"
mkrel v1.1
mkrel v1.2
echo 'payment_routes = BROKEN' >> "$R/v1.2/app.conf"
ln -sfn releases/v1.2 /opt/order-processor/current
EOF
ok "releases seeded; current -> v1.2"
