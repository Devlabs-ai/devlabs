#!/usr/bin/env bash
# Scatters order-processor configs, big dumps and recently changed files across /srv,
# /var/tmp and /etc/order-processor. Names and sizes vary per session.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"
service_user orders

box_script <<'EOF'
rm -rf /srv/apps /var/tmp/order-dumps /etc/order-processor /home/learner/answers /home/learner/recent
pick() { local a=("$@"); echo "${a[RANDOM % ${#a[@]}]}"; }

# Configs under /srv: some owned by orders (the answer), some by root or learner.
dirs=(/srv/apps/order-processor /srv/apps/order-processor/legacy /srv/apps/shared/conf.d
      /srv/apps/payment-handler /srv/apps/notification-service/templates /srv/apps/archive/2025)
for d in "${dirs[@]}"; do install -d "$d"; done
for i in $(seq 1 14); do
  d="$(pick "${dirs[@]}")"
  f="$d/$(pick app queue db cache routes worker limits)-$i.conf"
  echo "# config $i" > "$f"
  chown "$(pick orders orders root learner)" "$f"
done
for i in 1 2 3; do echo "# notes" > "/srv/apps/order-processor/notes-$i.txt"; chown orders "/srv/apps/order-processor/notes-$i.txt"; done
# Guarantee at least two answers and one decoy owned by orders that is not .conf.
echo "# main" > /srv/apps/order-processor/main.conf; chown orders /srv/apps/order-processor/main.conf
echo "# legacy" > /srv/apps/order-processor/legacy/old.conf; chown orders /srv/apps/order-processor/legacy/old.conf
echo "# owned by root" > /srv/apps/shared/conf.d/root-only.conf

# Dumps under /var/tmp: a few larger than 10 MiB.
install -d /var/tmp/order-dumps/2026-09 /var/tmp/order-dumps/2026-10
for i in $(seq 1 8); do
  size=$(( (RANDOM % 2) ? (RANDOM % 6 + 11) : (RANDOM % 6 + 1) ))
  head -c "$((size * 1024 * 1024))" /dev/zero > "/var/tmp/order-dumps/$(pick 2026-09 2026-10)/dump-$i.bin"
done
head -c $((15 * 1024 * 1024)) /dev/zero > /var/tmp/order-dumps/2026-10/dump-big.bin
head -c $((9 * 1024 * 1024)) /dev/zero > /var/tmp/order-dumps/2026-10/dump-just-under.bin
chmod -R a+rX /var/tmp/order-dumps

# /etc/order-processor: everything old, except a few changed in the last 2 days.
install -d /etc/order-processor/conf.d
for f in app.conf queue.conf db.conf limits.conf routes.conf conf.d/tls.conf conf.d/metrics.conf conf.d/retry.conf; do
  echo "# $f" > "/etc/order-processor/$f"
  touch -d "$((RANDOM % 60 + 10)) days ago" "/etc/order-processor/$f"
done
for f in $(printf '%s\n' app.conf db.conf limits.conf conf.d/retry.conf conf.d/tls.conf | shuf -n 2); do
  echo "# changed during the incident" >> "/etc/order-processor/$f"
  touch -d "$((RANDOM % 40 + 1)) hours ago" "/etc/order-processor/$f"
done
touch -d "4 days ago" /etc/order-processor/conf.d
EOF
ok "configs scattered"
