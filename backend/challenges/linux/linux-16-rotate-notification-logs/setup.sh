#!/usr/bin/env bash
# notification-service holding its log open and writing constantly; the log has already
# grown large, and there's no logrotate rule for it.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"
service_user notify

LOG_FILE=/var/log/notification-service/notification.log install_http_service notification-service v1.1 NOTIFICATION_PORT
write_unit notification-service.service <<'UNIT'
[Unit]
Description=Notification Service

[Service]
User=notify
Environment=NOTIFICATION_PORT=8085
ExecStart=/opt/notification-service/bin/notification-service
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

box_script <<'EOF'
systemctl stop notification-service 2>/dev/null || true
rm -rf /var/log/notification-service /etc/logrotate.d/notification-service
install -d -o notify -g notify -m 750 /var/log/notification-service
for i in $(seq 1 60000); do echo "2026-09-$((i % 30 + 1)) 00:00:00 sent email order=ORD-$((100000 + i))"; done \
  > /var/log/notification-service/notification.log
echo "2026-09-01 audit: digest delivered" > /var/log/notification-service/audit.log
chown notify:notify /var/log/notification-service/*.log
chmod 640 /var/log/notification-service/*.log
systemctl enable --now notification-service >/dev/null 2>&1
EOF
ok "notification-service writing to an unrotated log"
