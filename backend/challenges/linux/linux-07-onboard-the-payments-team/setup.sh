#!/usr/bin/env bash
# payment-handler running as a service, plus a departed engineer's account to offboard.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"
service_user payment-handler

install_http_service payment-handler v1.1 PAYMENT_HANDLER_PORT
write_unit payment-handler.service <<'UNIT'
[Unit]
Description=Payment Handler
After=network.target

[Service]
User=payment-handler
Environment=PAYMENT_HANDLER_PORT=9090
ExecStart=/opt/payment-handler/bin/payment-handler
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

box_script <<'EOF'
systemctl enable --now payment-handler.service >/dev/null 2>&1
for u in priya marco; do id "$u" >/dev/null 2>&1 && userdel -r "$u" 2>/dev/null || true; done
getent group payments-team >/dev/null && groupdel payments-team || true
rm -f /etc/sudoers.d/payments-team
id olek >/dev/null 2>&1 || useradd -m -s /bin/bash olek
echo 'olek:Winter2025!' | chpasswd
usermod -U -s /bin/bash olek 2>/dev/null || true
echo "olek's notes: payment gateway runbook draft" > /home/olek/runbook.md
chown olek:olek /home/olek/runbook.md
EOF
ok "payment-handler running; olek still has an active account"
