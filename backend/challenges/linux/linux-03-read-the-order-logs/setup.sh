#!/usr/bin/env bash
# A large static order log (length varies per session) plus a live log fed by a service
# that announces a new shift-handoff code every 30 seconds.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

lines=$((2000 + RANDOM % 3000))

box_script <<EOF
rm -rf /home/learner/answers
install -d -m 755 /var/log/order-processor
awk -v n=$lines -v seed=\$RANDOM 'BEGIN {
  srand(seed); split("INFO INFO INFO INFO WARN ERROR", lv, " ");
  split("accepted shipped paid retried cancelled", ev, " ");
  for (i = 1; i <= n; i++) {
    s = int(i * 86400 / n);
    printf "2026-09-30 %02d:%02d:%02d %s order ORD-%06d %s\n", s/3600, (s%3600)/60, s%60, lv[int(rand()*6)+1], int(rand()*1000000), ev[int(rand()*5)+1]
  }
}' > /var/log/order-processor/orders-2026-09-30.log
chmod 644 /var/log/order-processor/orders-2026-09-30.log
EOF

box_write /usr/local/sbin/order-live-feed 755 <<'SH'
#!/bin/bash
# Appends live order events; rotates the shift-handoff code every 30 seconds.
log=/var/log/order-processor/live.log
: > "$log"
i=0
while :; do
  if (( i % 30 == 0 )); then
    code="$(tr -dc 'A-Z0-9' </dev/urandom | head -c 6 || true)"
    echo "$(date -u '+%F %T') NOTICE shift handoff code=$code" >> "$log"
  fi
  echo "$(date -u '+%F %T') INFO order ORD-$(printf '%06d' $((RANDOM * 30 % 1000000))) accepted" >> "$log"
  i=$((i + 1))
  sleep 1
done
SH

write_unit order-live-feed.service <<'UNIT'
[Unit]
Description=Live order event feed (lab)

[Service]
ExecStart=/usr/local/sbin/order-live-feed
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
in_box 'systemctl enable --now order-live-feed.service >/dev/null 2>&1; chmod 644 /var/log/order-processor/live.log 2>/dev/null || true'
ok "order logs seeded ($lines lines) and live feed running"
