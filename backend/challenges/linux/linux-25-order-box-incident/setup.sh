#!/usr/bin/env bash
# Capstone: several faults at once on the order box.
#   - a forgotten root cron job fills the 48 MiB log volume with debug dumps every minute
#   - order-processor's state dir is owned by root, so it can't start
#   - payment-handler was masked during a maintenance window and never unmasked
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"
service_user orders
service_user payment-handler

LOG_FILE=/var/log/order-processor/order-processor.log STATE_DIR=/var/lib/order-processor \
  install_http_service order-processor v1.2 ORDER_PROCESSOR_PORT
install_http_service payment-handler v1.1 PAYMENT_HANDLER_PORT

write_unit order-processor.service <<'UNIT'
[Unit]
Description=Order Processor
RequiresMountsFor=/var/log/order-processor

[Service]
User=orders
Environment=ORDER_PROCESSOR_PORT=8080
ExecStart=/opt/order-processor/bin/order-processor
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
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

box_write /usr/local/bin/debug-dump 755 <<'SH'
#!/bin/bash
# Temporary: capture order-processor debug state every minute. (INC-4411, remove after.)
head -c $((4 * 1024 * 1024)) /dev/urandom > "/var/log/order-processor/debug-$(date +%s).dump" 2>/dev/null || true
SH

box_script <<'EOF'
systemctl stop order-processor payment-handler 2>/dev/null || true
systemctl unmask payment-handler >/dev/null 2>&1 || true
mountpoint -q /var/log/order-processor && umount /var/log/order-processor
install -d /var/log/order-processor
mount -t tmpfs -o size=48M,mode=755 order-logs /var/log/order-processor
: > /var/log/order-processor/order-processor.log
chown orders:orders /var/log/order-processor/order-processor.log
install -d -o root -g root -m 755 /var/lib/order-processor
rm -rf /home/learner/answers
echo '* * * * * root /usr/local/bin/debug-dump' > /etc/cron.d/debug-dump
chmod 644 /etc/cron.d/debug-dump
for i in $(seq 1 11); do
  head -c $((4 * 1024 * 1024)) /dev/urandom > "/var/log/order-processor/debug-$(( $(date +%s) - i * 60 )).dump" 2>/dev/null || break
done
systemctl enable --now cron >/dev/null 2>&1
systemctl enable order-processor >/dev/null 2>&1
systemctl start order-processor 2>/dev/null || true
systemctl disable payment-handler >/dev/null 2>&1 || true
systemctl mask payment-handler >/dev/null 2>&1
EOF
ok "incident staged"
