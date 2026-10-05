#!/usr/bin/env bash
# Four services listening on all interfaces with no firewall: ssh (22), order-processor
# (8080), a metrics exporter (9100) and a debug cache (6379) that must not be exposed.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"
service_user orders

install_http_service order-processor v1.2 ORDER_PROCESSOR_PORT 0.0.0.0
install_http_service metrics-exporter v0.9 METRICS_PORT 0.0.0.0
install_http_service order-cache v0.1 CACHE_PORT 0.0.0.0
for spec in "order-processor ORDER_PROCESSOR_PORT 8080" "metrics-exporter METRICS_PORT 9100" "order-cache CACHE_PORT 6379"; do
  read -r name var port <<<"$spec"
  write_unit "$name.service" <<UNIT
[Unit]
Description=$name

[Service]
User=orders
Environment=$var=$port
ExecStart=/opt/$name/bin/$name
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
done

box_script <<'EOF'
nft flush ruleset
printf '#!/usr/sbin/nft -f\nflush ruleset\n' > /etc/nftables.conf
systemctl disable nftables >/dev/null 2>&1 || true
systemctl enable --now order-processor metrics-exporter order-cache >/dev/null 2>&1
systemctl start ssh.socket
EOF
ok "services listening; no firewall"
