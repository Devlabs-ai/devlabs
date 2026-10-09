#!/usr/bin/env bash
# notification-service with four stacked faults, each only visible once the previous one
# is fixed: wrong ExecStart path, non-executable binary, a typo in its env file, and a
# leftover debug listener squatting on its port.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"
service_user notify

REQUIRE="SMTP_HOST" install_http_service notification-service v1.1 NOTIFICATION_PORT
box_script <<'EOF'
chmod 644 /opt/notification-service/bin/notification-service
install -d -m 755 /etc/notification-service
cat > /etc/notification-service/notification.env <<'ENV'
NOTIFICATION_PORT=8085
SMTP_HSOT=smtp.internal
SMTP_FROM=orders@example-shop.test
ENV
cat > /etc/systemd/system/notification-service.service <<'UNIT'
[Unit]
Description=Notification Service
After=network.target

[Service]
User=notify
EnvironmentFile=/etc/notification-service/notification.env
ExecStart=/opt/notification-service/bin/notification-svc
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
cat > /usr/local/bin/debug-listener <<'SH'
#!/bin/bash
# Temporary debug listener (left behind by the last incident).
while :; do nc -l 127.0.0.1 8085 >/dev/null 2>&1; sleep 0.2; done
SH
chmod 755 /usr/local/bin/debug-listener
pkill -f /usr/local/bin/debug-listener || true
setsid nohup /usr/local/bin/debug-listener </dev/null >/dev/null 2>&1 &
systemctl daemon-reload
systemctl enable notification-service.service >/dev/null 2>&1
systemctl restart notification-service.service 2>/dev/null || true
EOF
ok "notification-service installed (broken)"
