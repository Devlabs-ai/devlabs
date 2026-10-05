#!/usr/bin/env bash
# Fills the 64 MiB /var/log/order-processor volume: old rotated logs, a heap dump, and a
# spool file that order-exporter still holds open after it was deleted (du and df disagree).
# order-processor can't write its log and keeps crashing.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"
service_user orders

LOG_FILE=/var/log/order-processor/order-processor.log install_http_service order-processor v1.2 ORDER_PROCESSOR_PORT
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

box_write /opt/order-processor/bin/order-exporter 755 <<'SH'
#!/bin/bash
# Streams exported orders through a spool file it keeps open.
spool=/var/log/order-processor/export-spool.tmp
exec 4>"$spool"
head -c $((1024 * 1024)) /dev/zero >&4
if [ -f /var/lib/devlabs/exporter-backlog ]; then
  rm -f /var/lib/devlabs/exporter-backlog
  head -c $((14 * 1024 * 1024)) /dev/zero >&4
fi
echo "order-exporter: spooling to $spool"
while sleep 60; do :; done
SH
write_unit order-exporter.service <<'UNIT'
[Unit]
Description=Order Exporter
RequiresMountsFor=/var/log/order-processor

[Service]
ExecStart=/opt/order-processor/bin/order-exporter

[Install]
WantedBy=multi-user.target
UNIT

box_script <<'EOF'
systemctl stop order-processor order-exporter 2>/dev/null || true
mountpoint -q /var/log/order-processor && umount /var/log/order-processor
install -d /var/log/order-processor
mount -t tmpfs -o size=64M,mode=755 order-logs /var/log/order-processor
rm -f /var/tmp/order-processor-heap.hprof /home/learner/answers/held-by
cd /var/log/order-processor
for i in 1 2 3 4 5; do
  { base64 -w 120 /dev/urandom | head -c $((8 * 1024 * 1024)) > "order-processor.log.$i"; } || true
  touch -d "$i days ago" "order-processor.log.$i"
done
head -c $((7 * 1024 * 1024)) /dev/urandom > order-processor-heap.hprof
: > order-processor.log
chown orders:orders order-processor.log*
install -d -m 700 /var/lib/devlabs
touch /var/lib/devlabs/exporter-backlog
systemctl enable --now order-exporter >/dev/null 2>&1
sleep 2
rm -f /var/log/order-processor/export-spool.tmp
systemctl show -p MainPID --value order-exporter > /var/lib/devlabs/exporter.pid
cat /dev/zero >> order-processor.log 2>/dev/null || true
systemctl enable order-processor >/dev/null 2>&1
systemctl start order-processor 2>/dev/null || true
EOF
ok "log volume full; order-processor crash-looping"
