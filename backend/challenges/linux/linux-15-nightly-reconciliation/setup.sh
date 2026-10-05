#!/usr/bin/env bash
# Jobs that someone runs by hand today: order reconciliation (as recon), the
# notification digest (as notify) and learner's morning disk report.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"
service_user recon
service_user notify

box_write /opt/order-reconciliation/bin/reconcile 755 <<'SH'
#!/bin/bash
# Reconciles yesterday's orders against payments.
set -e
state=/var/lib/order-reconciliation
echo "reconcile: comparing orders and payments for $(date -u -d yesterday +%F)"
date -u +%FT%TZ > "$state/last-run"
echo "reconcile: 0 mismatches"
SH
box_write /opt/notification-service/bin/digest 755 <<'SH'
#!/bin/bash
# Sends the notification digest email.
echo "digest: sent $(date -u +%FT%TZ)"
SH
box_write /opt/order-processor/bin/disk-report 755 <<'SH'
#!/bin/bash
# Mails the morning disk usage report.
df -h / | tail -1
SH

box_script <<'EOF'
install -d -o recon -g recon -m 755 /var/lib/order-reconciliation
rm -f /var/lib/order-reconciliation/last-run /etc/cron.d/notification-digest
rm -f /etc/systemd/system/order-reconcile.{service,timer}
systemctl daemon-reload
crontab -r -u learner 2>/dev/null || true
systemctl enable --now cron >/dev/null 2>&1
EOF
ok "jobs installed; nothing scheduled yet"
