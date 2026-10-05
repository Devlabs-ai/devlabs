#!/usr/bin/env bash
# Three services and a registry of their ports; notification-service is down.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"
service_user orders

for spec in "order-processor ORDER_PROCESSOR_PORT 8080 v1.2" "payment-handler PAYMENT_HANDLER_PORT 9090 v1.1" "notification-service NOTIFICATION_PORT 8085 v1.1"; do
  read -r name var port version <<<"$spec"
  install_http_service "$name" "$version" "$var"
  write_unit "$name.service" <<UNIT
[Unit]
Description=$name

[Service]
User=orders
Environment=$var=$port
ExecStart=/opt/$name/bin/$name
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
done

box_script <<'EOF'
install -d -m 755 /etc/order-platform
cat > /etc/order-platform/services <<'REG'
# service              port
order-processor        8080
payment-handler        9090
notification-service   8085
REG
rm -f /usr/local/bin/check-health
systemctl enable --now order-processor payment-handler >/dev/null 2>&1
systemctl disable --now notification-service >/dev/null 2>&1 || true
EOF
ok "services up (notification-service down); no check-health yet"
