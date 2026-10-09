#!/usr/bin/env bash
# Vendor units for payment-handler and order-processor. order-processor exits at start
# when payment-handler isn't up, and its unit has no ordering and no restart policy.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"
service_user orders
service_user payment-handler

install_http_service payment-handler v1.1 PAYMENT_HANDLER_PORT
install_http_service order-processor v1.2 ORDER_PROCESSOR_PORT
in_box 'mv -f /opt/order-processor/bin/order-processor /opt/order-processor/bin/order-processor-server'
box_write /opt/order-processor/bin/order-processor 755 <<'SH'
#!/bin/bash
# order-processor needs payment-handler at startup to load payment routes.
if ! curl -fsS --max-time 2 http://127.0.0.1:9090/health >/dev/null 2>&1; then
  echo "order-processor: payment-handler unreachable at 127.0.0.1:9090, cannot load payment routes" >&2
  exit 1
fi
exec /opt/order-processor/bin/order-processor-server
SH

write_unit payment-handler.service <<'UNIT'
[Unit]
Description=Payment Handler

[Service]
User=payment-handler
Environment=PAYMENT_HANDLER_PORT=9090
ExecStart=/opt/payment-handler/bin/payment-handler
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

write_unit order-processor.service <<'UNIT'
[Unit]
Description=Order Processor

[Service]
User=orders
Environment=ORDER_PROCESSOR_PORT=8080
ExecStart=/opt/order-processor/bin/order-processor

[Install]
WantedBy=multi-user.target
UNIT

box_script <<'EOF'
rm -rf /etc/systemd/system/order-processor.service /etc/systemd/system/order-processor.service.d
systemctl daemon-reload
install -d -m 700 /var/lib/devlabs
sha256sum /lib/systemd/system/order-processor.service > /var/lib/devlabs/order-processor.unit.sha256
systemctl enable payment-handler.service order-processor.service >/dev/null 2>&1
systemctl stop payment-handler.service order-processor.service
systemctl reset-failed order-processor.service 2>/dev/null || true
systemctl start order-processor.service 2>/dev/null || true
EOF
ok "units installed; order-processor failed at start (payment-handler down)"
