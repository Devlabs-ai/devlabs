#!/usr/bin/env bash
# orders.csv with per-session data (distinct completed counts per region, so the top 3
# has no ties) and an export tool that writes data to stdout and warnings to stderr.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_script <<'EOF'
rm -rf /home/learner/reports /srv/orders
install -d -m 755 /srv/orders
regions=(north south east west central coastal highlands metro)
mapfile -t regions < <(printf '%s\n' "${regions[@]}" | shuf)
customers=(acme-retail bluefin-co cobalt-labs dunmore-foods everline-tech fable-books
           granite-mart harbor-supply ion-motors juniper-home kestrel-sport lumen-pharma)
{
  echo "date,order_id,customer,region,status,amount"
  n=0
  for i in "${!regions[@]}"; do
    r="${regions[$i]}"
    completed=$((12 + i * 6 + RANDOM % 4))
    for _ in $(seq 1 "$completed"); do
      n=$((n + 1)); echo "2026-09-30,ORD-$(printf '%06d' $((RANDOM * 30 + n))),${customers[RANDOM % 12]},$r,completed,$((RANDOM % 400 + 5)).$((RANDOM % 90 + 10))"
    done
    for _ in $(seq 1 $((RANDOM % 6 + 2))); do
      n=$((n + 1)); echo "2026-09-30,ORD-$(printf '%06d' $((RANDOM * 30 + n))),${customers[RANDOM % 12]},$r,$( (( RANDOM % 2 )) && echo failed || echo cancelled ),$((RANDOM % 400 + 5)).$((RANDOM % 90 + 10))"
    done
  done | shuf
} > /srv/orders/orders.csv
chmod 644 /srv/orders/orders.csv

install -d -m 755 /opt/order-processor/bin
cat > /opt/order-processor/bin/order-export <<'SH'
#!/bin/bash
# Exports completed orders as order_id,amount. Problems go to stderr.
awk -F, 'NR > 1 {
  if ($5 == "completed") print $2 "," $6;
  else printf "warning: skipping %s (status %s)\n", $2, $5 > "/dev/stderr";
}' /srv/orders/orders.csv
SH
chmod 755 /opt/order-processor/bin/order-export
EOF
ok "orders.csv and order-export seeded"
