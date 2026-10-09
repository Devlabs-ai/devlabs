#!/usr/bin/env bash
# A long-running export the learner must start so it survives the terminal closing.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_write /opt/order-processor/bin/batch-export 755 <<'SH'
#!/bin/bash
# Exports order batches to the warehouse. Takes about an hour.
total=1800
echo "batch-export: starting, $total batches"
for i in $(seq 1 "$total"); do
  echo "batch-export: exported batch $i/$total"
  sleep 2
done
echo "batch-export: done"
SH

box_script <<'EOF'
pkill -9 -f /opt/order-processor/bin/batch-export || true
rm -f /home/learner/batch-export.log /home/learner/nohup.out
EOF
ok "batch-export installed"
