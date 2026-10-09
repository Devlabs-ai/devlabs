#!/usr/bin/env bash
# order-processor calls http://payment.internal:9090. Two faults: payment.internal points
# at a decommissioned IP in /etc/hosts, and payment-handler listens on the wrong port.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"
service_user payment-handler

install_http_service payment-handler v1.1 PAYMENT_HANDLER_PORT
write_unit payment-handler.service <<'UNIT'
[Unit]
Description=Payment Handler

[Service]
User=payment-handler
EnvironmentFile=/etc/payment-handler/payment-handler.env
ExecStart=/opt/payment-handler/bin/payment-handler
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

box_write /opt/order-processor/bin/check-payments 755 <<'SH'
#!/bin/bash
# What order-processor does at startup: call payment-handler's health endpoint.
url="$(awk -F' *= *' '/^payments_url/ {print $2}' /etc/order-processor/app.conf)"
echo "order-processor: checking $url/health"
if curl -fsS --max-time 3 "$url/health"; then echo; echo "order-processor: payment-handler OK"; else echo "order-processor: cannot reach payment-handler" >&2; exit 1; fi
SH

box_script <<'EOF'
install -d -m 755 /etc/payment-handler /etc/order-processor
echo 'PAYMENT_HANDLER_PORT=9099' > /etc/payment-handler/payment-handler.env
printf 'port = 8080\npayments_url = http://payment.internal:9090\n' > /etc/order-processor/app.conf
hosts="$(grep -v 'payment\.internal' /etc/hosts || true)"
printf '%s\n%s\n' "$hosts" '10.99.0.7   payment.internal   # payments-v1 cluster' > /etc/hosts
rm -rf /home/learner/answers
systemctl enable payment-handler >/dev/null 2>&1
systemctl restart payment-handler
EOF
ok "payment.internal misrouted; payment-handler on the wrong port"
