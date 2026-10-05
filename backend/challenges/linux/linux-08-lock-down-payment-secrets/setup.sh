#!/usr/bin/env bash
# Seeds a payment-handler install whose secrets are readable (and writable) by anyone.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_script <<'EOF'
getent group payments >/dev/null || groupadd --system payments
id payment-handler >/dev/null 2>&1 || useradd --system --gid payments --no-create-home \
  --home-dir /opt/payment-handler --shell /usr/sbin/nologin payment-handler
gpasswd -d learner payments >/dev/null 2>&1 || true

install -d /opt/payment-handler/bin /etc/payment-handler /var/log/payment-handler

cat > /etc/payment-handler/payment-handler.conf <<'CONF'
# payment-handler settings (not secret)
listen = 0.0.0.0:8443
gateway = https://gateway.example-pay.test
CONF

hex() { tr -dc 'a-f0-9' </dev/urandom | head -c "$1" || true; }

cat > /etc/payment-handler/secrets.env <<CONF
GATEWAY_MERCHANT_ID=mrc_$(hex 12)
GATEWAY_API_SECRET=sk_live_$(hex 32)
DB_PASSWORD=$(hex 24)
CONF

hex 64 > /etc/payment-handler/signing.key

cat > /opt/payment-handler/bin/rotate-keys.sh <<'SH'
#!/bin/sh
# Rotates the payment signing key. Runs as payment-handler.
tr -dc 'a-f0-9' </dev/urandom | head -c 64 > /etc/payment-handler/signing.key
SH

echo "$(date -u +%FT%TZ) payment-handler started" > /var/log/payment-handler/payment-handler.log

# The mess the previous admin left behind.
chown -R learner:learner /etc/payment-handler /var/log/payment-handler /opt/payment-handler
chmod 777 /etc/payment-handler /var/log/payment-handler /opt/payment-handler/bin/rotate-keys.sh
chmod 666 /etc/payment-handler/* /var/log/payment-handler/*
EOF
ok "payment-handler seeded with open permissions"
