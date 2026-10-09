#!/usr/bin/env bash
# A spool of incoming order batch CSVs (count, sizes and one name with a space vary).
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_script <<'EOF'
rm -rf /var/spool/orders /home/learner/bin
install -d -o learner -g learner /var/spool/orders /var/spool/orders/incoming /var/spool/orders/processed
n=$((RANDOM % 3 + 3))
for i in $(seq 1 "$n"); do
  f="/var/spool/orders/incoming/batch-$(printf '%04d' "$i").csv"
  [ "$i" -eq 2 ] && f="/var/spool/orders/incoming/batch $(printf '%04d' "$i") (retry).csv"
  { echo "order_id,customer,amount"; for j in $(seq 1 $((RANDOM % 40 + 5))); do echo "ORD-$((RANDOM * 10 + j)),cust-$((RANDOM % 50)),$((RANDOM % 300)).00"; done; } > "$f"
done
chown -R learner:learner /var/spool/orders
sed -i '/process-batches\|ORDER_SPOOL\|HOME\/bin/d' /home/learner/.bashrc
EOF
ok "order batches spooled"
