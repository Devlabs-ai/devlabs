#!/usr/bin/env bash
# Starts three background jobs as orders: a CPU-burning reindex that ignores SIGTERM,
# a report builder that should only be deprioritized, and a retry worker to leave alone.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"
service_user orders

box_write /opt/order-processor/bin/order-reindex 755 <<'SH'
#!/bin/bash
# Rebuilds the order search index. (Bug: spins forever and ignores SIGTERM.)
trap '' TERM
while :; do :; done
SH
box_write /opt/order-processor/bin/report-builder 755 <<'SH'
#!/bin/bash
# Builds the nightly report in small steps.
while :; do sleep 5; done
SH
box_write /opt/notification-service/bin/notification-retry 755 <<'SH'
#!/bin/bash
# Retries failed notifications every few seconds.
while :; do sleep 3; done
SH

box_script <<'EOF'
pkill -f -9 '/opt/(order-processor|notification-service)/bin/' || true
rm -rf /home/learner/answers
install -d -m 700 /var/lib/devlabs
start() { setsid nohup setpriv --reuid orders --regid orders --init-groups -- "$@" </dev/null >/dev/null 2>&1 & }
start /opt/notification-service/bin/notification-retry
start /opt/order-processor/bin/report-builder
start /opt/order-processor/bin/order-reindex
sleep 1
pgrep -u orders -f /opt/order-processor/bin/order-reindex | head -1 > /var/lib/devlabs/runaway.pid
test -s /var/lib/devlabs/runaway.pid
EOF
ok "background jobs started"
