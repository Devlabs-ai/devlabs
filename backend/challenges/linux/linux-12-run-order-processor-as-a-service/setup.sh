#!/usr/bin/env bash
# Installs order-processor (a tiny HTTP health server) with no unit file: today it only
# runs when someone starts it by hand in a terminal.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_script <<'EOF'
id orders >/dev/null 2>&1 || useradd --system --user-group --no-create-home \
  --home-dir /opt/order-processor --shell /usr/sbin/nologin orders

install -d -m 755 /opt/order-processor/bin /etc/order-processor

cat > /opt/order-processor/bin/order-processor <<'SH'
#!/bin/bash
# order-processor v1.2 — serves GET /health on $ORDER_PROCESSOR_PORT.
set -u
if [ -z "${ORDER_PROCESSOR_PORT:-}" ]; then
  echo "order-processor: ORDER_PROCESSOR_PORT is not set (see /etc/order-processor/order-processor.env)" >&2
  exit 2
fi
if [ "$(id -u)" -eq 0 ]; then
  echo "order-processor: refusing to run as root; run me as the orders user" >&2
  exit 3
fi
echo "order-processor v1.2 listening on 127.0.0.1:${ORDER_PROCESSOR_PORT} as $(id -un)"
trap 'echo "order-processor: shutting down"; exit 0' TERM INT
body='{"status":"ok","service":"order-processor","version":"1.2"}'
while :; do
  printf 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %s\r\nConnection: close\r\n\r\n%s' \
    "${#body}" "$body" | nc -l -N 127.0.0.1 "$ORDER_PROCESSOR_PORT" >/dev/null &
  wait $! || sleep 0.2
done
SH
chmod 755 /opt/order-processor/bin/order-processor

cat > /etc/order-processor/order-processor.env <<'ENV'
ORDER_PROCESSOR_PORT=8080
ENV
chmod 644 /etc/order-processor/order-processor.env

systemctl disable --now order-processor.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/order-processor.service
rm -rf /etc/systemd/system/order-processor.service.d
systemctl daemon-reload
pkill -f /opt/order-processor/bin/order-processor || true
EOF
ok "order-processor installed (no unit yet)"
