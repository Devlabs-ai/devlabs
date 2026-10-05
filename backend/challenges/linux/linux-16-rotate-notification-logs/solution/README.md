# Solution — Rotate Notification Logs

`logrotate` runs daily (from a systemd timer or cron). It renames `x.log` to `x.log.1`, compresses old copies and deletes the oldest. One question matters most: **does the service reopen its log?** notification-service doesn't. It keeps the file open forever. A plain rename would leave it writing into `notification.log.1`, so use `copytruncate`: copy the content out, then truncate the original in place.

Docs: `man logrotate`

## Inspect

```bash
ls -lh /var/log/notification-service/
sudo lsof /var/log/notification-service/notification.log     # the service holds it open
cat /etc/logrotate.conf; ls /etc/logrotate.d/                # examples to copy from
```

## Write the rule

```bash
sudo tee /etc/logrotate.d/notification-service >/dev/null <<'EOF'
/var/log/notification-service/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF
```

| Directive | Why |
|-----------|-----|
| `daily`, `rotate 7` | one file per day, keep a week |
| `compress`, `delaycompress` | gzip old logs, but leave the newest `.1` plain for easy reading |
| `missingok`, `notifempty` | don't error on a missing file; skip empty ones |
| `copytruncate` | the service keeps its file open, so truncate in place |

If the service could reopen its logs on a signal, `create` plus a `postrotate` running `systemctl reload ...` would be cleaner. With copytruncate, a few lines can be lost between the copy and the truncate.

## Test

```bash
sudo logrotate -d /etc/logrotate.d/notification-service      # dry run
sudo logrotate -f /etc/logrotate.d/notification-service      # force one rotation now
ls -lh /var/log/notification-service/
tail -f /var/log/notification-service/notification.log       # new heartbeats keep arriving
```

Then **Submit**.
