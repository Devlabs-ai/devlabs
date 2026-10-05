# Solution — Restart on Crash, Start in Order

Units shipped by a package live in `/lib/systemd/system/`, and an upgrade overwrites them. Your changes go in a **drop-in** file under `/etc/systemd/system/<unit>.d/`. It overrides only the settings you list and survives upgrades.

Docs: `man systemd.unit` (Requires=, After=) · `man systemd.service` (Restart=) · `man systemctl` (edit, cat)

## See the failure

```bash
systemctl status order-processor
journalctl -u order-processor -n 20      # payment-handler unreachable
systemctl cat order-processor            # no After=, no Restart=
```

## Write the drop-in

```bash
sudo systemctl edit order-processor
```

Add these lines between the comment markers. `systemctl edit` saves them to `/etc/systemd/system/order-processor.service.d/override.conf` and reloads systemd for you:

```ini
[Unit]
Requires=payment-handler.service
After=payment-handler.service

[Service]
Restart=on-failure
RestartSec=2
```

- `Requires=`: starting order-processor also starts payment-handler, and stopping payment-handler stops order-processor.
- `After=`: ordering only, meaning "wait until payment-handler has started". `Requires=` alone starts both units at the same time.
- `Restart=on-failure`: restart after a crash or non-zero exit.

Without `systemctl edit`:

```bash
sudo mkdir -p /etc/systemd/system/order-processor.service.d
sudo nano /etc/systemd/system/order-processor.service.d/override.conf
sudo systemctl daemon-reload
```

## Verify

```bash
systemctl cat order-processor                     # vendor unit + your drop-in
sudo systemctl stop order-processor payment-handler
sudo systemctl start order-processor              # payment-handler starts first
systemctl status payment-handler order-processor
curl http://127.0.0.1:8080/health
sudo kill -9 "$(systemctl show -p MainPID --value order-processor)"
sleep 3; systemctl status order-processor         # back, new PID
```

Then **Submit**.
