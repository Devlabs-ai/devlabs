# Solution — Nightly Reconciliation

There are two schedulers on every modern Linux box:
- **cron**: one line per job; simple and everywhere.
- **systemd timers**: more verbose, but you get logs in the journal, `Persistent=` catch-up after downtime, and `systemctl list-timers`.

Docs: `man 5 crontab` · `man systemd.timer` · `man systemd.time` (CALENDAR EVENTS)

## Timer + service for reconciliation

```bash
sudo tee /etc/systemd/system/order-reconcile.service >/dev/null <<'EOF'
[Unit]
Description=Reconcile yesterday's orders

[Service]
Type=oneshot
User=recon
ExecStart=/opt/order-reconciliation/bin/reconcile
EOF

sudo tee /etc/systemd/system/order-reconcile.timer >/dev/null <<'EOF'
[Unit]
Description=Nightly order reconciliation

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now order-reconcile.timer
systemctl list-timers order-reconcile.timer
systemd-analyze calendar '*-*-* 02:30:00'       # check the expression
sudo systemctl start order-reconcile.service     # run once now to test
journalctl -u order-reconcile.service -n 5
```

You enable the **timer**, not the service. The service has no `[Install]` section.

## System cron file for the digest

Files in `/etc/cron.d/` have an extra **user** column:

```bash
echo '*/15 * * * * notify /opt/notification-service/bin/digest' | sudo tee /etc/cron.d/notification-digest
sudo chmod 644 /etc/cron.d/notification-digest
```

The fields are: minute, hour, day of month, month, day of week, user, command.

## Your own crontab

```bash
crontab -e
```

```
0 7 * * * /opt/order-processor/bin/disk-report
```

```bash
crontab -l
```

Then **Submit**.
