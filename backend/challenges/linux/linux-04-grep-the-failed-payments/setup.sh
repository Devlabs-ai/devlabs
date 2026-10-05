#!/usr/bin/env bash
# A payment-handler log with mixed-case failures, decline codes and look-alike tokens,
# plus a config tree where only some files mention timeouts.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_script <<'EOF'
rm -rf /home/learner/answers /etc/payment-handler
install -d -m 755 /var/log/payment-handler /etc/payment-handler/conf.d /etc/payment-handler/gateways
awk -v seed=$RANDOM 'BEGIN {
  srand(seed); n = 1500 + int(rand() * 1000);
  for (i = 1; i <= n; i++) {
    t = sprintf("2026-09-30 %02d:%02d:%02d", i*86400/n/3600, (i*86400/n%3600)/60, i*86400/n%60);
    o = sprintf("ORD-%06d", int(rand() * 1000000)); r = rand();
    if      (r < 0.55) printf "%s INFO  payment %s captured amount=%d.00\n", t, o, int(rand()*500)+1;
    else if (r < 0.65) printf "%s WARN  payment %s FAILED code=E402 card declined by issuer\n", t, o;
    else if (r < 0.72) printf "%s WARN  payment %s failed code=E402 insufficient funds\n", t, o;
    else if (r < 0.78) printf "%s ERROR payment %s Failed code=E500 gateway timeout\n", t, o;
    else if (r < 0.82) printf "%s WARN  payment %s failed code=E4021 card declined (3ds)\n", t, o;
    else if (r < 0.87) printf "%s INFO  payment %s retry scheduled after failure code=E409\n", t, o;
    else if (r < 0.92) printf "%s INFO  payment %s predeclined screening passed\n", t, o;
    else               printf "%s INFO  refund %s processed\n", t, o;
  }
}' > /var/log/payment-handler/payments.log
chmod 644 /var/log/payment-handler/payments.log

pick() { local a=("$@"); echo "${a[RANDOM % ${#a[@]}]}"; }
for f in payment-handler.conf conf.d/db.conf conf.d/cache.conf conf.d/limits.conf \
         gateways/stripe.conf gateways/adyen.conf gateways/paypal.conf conf.d/tls.conf; do
  { echo "# /etc/payment-handler/$f"; echo "enabled = true"; } > "/etc/payment-handler/$f"
done
for f in $(printf '%s\n' payment-handler.conf conf.d/db.conf conf.d/cache.conf gateways/stripe.conf gateways/adyen.conf gateways/paypal.conf | shuf -n 3); do
  echo "$(pick connect_timeout read_timeout timeout) = $((RANDOM % 30 + 1))s" >> "/etc/payment-handler/$f"
done
echo "# Timeouts are configured per gateway" >> /etc/payment-handler/conf.d/tls.conf
chmod -R a+rX /etc/payment-handler
EOF
ok "payment logs and configs seeded"
