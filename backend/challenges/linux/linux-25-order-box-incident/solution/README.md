# Solution — Order-Box Incident

Three independent faults, found with the tools from the earlier labs. Triage first, then fix each root cause, not just its symptom.

## Triage

```bash
systemctl --failed
systemctl status order-processor payment-handler
journalctl -u order-processor -n 20 --no-pager
df -h /var/log/order-processor
```

## Fault 1: the log volume keeps filling (labs 15, 18)

```bash
ls -lhS /var/log/order-processor          # debug-*.dump, 4 MiB each, one per minute
grep -r debug-dump /etc/cron.d /etc/crontab
cat /usr/local/bin/debug-dump              # "Temporary ... remove after"
sudo rm /etc/cron.d/debug-dump             # stop the source first
sudo rm /var/log/order-processor/*.dump    # then clean up
df -h /var/log/order-processor
```

If you delete the dumps but leave the cron job, the volume fills up again within minutes.

## Fault 2: order-processor can't write its state (labs 8, 14)

```bash
journalctl -u order-processor -n 5 --no-pager    # cannot write to /var/lib/order-processor
ls -ld /var/lib/order-processor                  # root:root 755
sudo chown orders:orders /var/lib/order-processor
sudo systemctl restart order-processor
```

## Fault 3: payment-handler is masked (labs 12, 13)

```bash
systemctl status payment-handler          # Loaded: masked
sudo systemctl unmask payment-handler
sudo systemctl enable --now payment-handler
```

A masked unit is symlinked to `/dev/null`, so nothing can start it: not you, not a dependency, not a reboot.

## Verify

```bash
systemctl is-active order-processor payment-handler
curl http://127.0.0.1:8080/health; echo
curl http://127.0.0.1:9090/health; echo
```

## Write it up

```bash
mkdir -p ~/answers
cat > ~/answers/incident.md <<'EOF'
1. Leftover debug cron job (INC-4411) filled /var/log/order-processor every minute; removed job and dumps.
2. /var/lib/order-processor owned by root; order-processor (user orders) couldn't write state; chowned to orders.
3. payment-handler masked during maintenance and never unmasked; unmasked, enabled and started.
EOF
```

Then **Submit**.
