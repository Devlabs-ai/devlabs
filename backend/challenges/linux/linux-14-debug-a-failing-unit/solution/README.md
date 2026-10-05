# Solution — Debug a Failing Unit

The loop is always the same: **status → journal → fix one thing → daemon-reload if the unit changed → restart → repeat**. Each fix reveals the next error.

Docs: `man systemctl` · `man journalctl` · `man ss`

## Fault 1: wrong ExecStart path

```bash
systemctl status notification-service
# status=203/EXEC   — systemd couldn't execute the program
journalctl -u notification-service -n 20 --no-pager
# Failed to locate executable /opt/notification-service/bin/notification-svc
ls /opt/notification-service/bin/
sudo sed -i 's#bin/notification-svc$#bin/notification-service#' /etc/systemd/system/notification-service.service
sudo systemctl daemon-reload
sudo systemctl restart notification-service
```

## Fault 2: binary not executable

```bash
journalctl -u notification-service -n 5 --no-pager
# Permission denied / 203/EXEC again
ls -l /opt/notification-service/bin/notification-service     # -rw-r--r--
sudo chmod 755 /opt/notification-service/bin/notification-service
sudo systemctl restart notification-service
```

## Fault 3: typo in the environment file

```bash
journalctl -u notification-service -n 5 --no-pager
# notification-service: SMTP_HOST is not set
cat /etc/notification-service/notification.env               # SMTP_HSOT
sudo sed -i 's/^SMTP_HSOT=/SMTP_HOST=/' /etc/notification-service/notification.env
sudo systemctl restart notification-service
```

Env file changes need a restart, not a `daemon-reload`.

## Fault 4: port already in use

```bash
journalctl -u notification-service -n 5 --no-pager
# cannot listen on 127.0.0.1:8085 (address in use?)
sudo ss -tlnp | grep 8085          # users:(("nc",pid=...))
ps -fp <pid>                        # parent: /usr/local/bin/debug-listener
sudo pkill -f /usr/local/bin/debug-listener
sudo systemctl restart notification-service
```

## Verify

```bash
systemctl status notification-service
curl http://127.0.0.1:8085/health
```

Then **Submit**.
