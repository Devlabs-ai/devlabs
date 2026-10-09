# Solution — Run Order Processor as a Service

Right now order-processor only runs while someone keeps a terminal open. A **systemd unit** makes systemd own the process: start it on boot, run it as a dedicated user, feed it its settings, and restart it when it crashes.

Docs: `man systemd.service` · `man systemd.exec` (User=, EnvironmentFile=) · `man systemd.unit` ([Install])

## See why it can't run by hand

```bash
/opt/order-processor/bin/order-processor
# ORDER_PROCESSOR_PORT is not set
sudo /opt/order-processor/bin/order-processor
# refusing to run as root
cat /etc/order-processor/order-processor.env
id orders
```

## Write the unit

```bash
sudo nano /etc/systemd/system/order-processor.service
```

```ini
[Unit]
Description=Order Processor
After=network.target

[Service]
User=orders
Group=orders
EnvironmentFile=/etc/order-processor/order-processor.env
ExecStart=/opt/order-processor/bin/order-processor
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
```

- `User=` — run as `orders`, never root.
- `EnvironmentFile=` — settings stay in `/etc/order-processor/`; ops can change the port without editing the unit.
- `Restart=on-failure` — restart on a crash or non-zero exit, but not after a clean `systemctl stop`.
- `WantedBy=multi-user.target` — what `systemctl enable` hooks into, so it starts on boot.

## Load, enable, start

```bash
sudo systemctl daemon-reload                    # pick up the new/changed unit file
sudo systemctl enable --now order-processor     # enable for boot + start now
systemctl status order-processor
journalctl -u order-processor -n 20
curl http://127.0.0.1:8080/health
```

## Prove it survives a crash

```bash
sudo kill -9 "$(systemctl show -p MainPID --value order-processor)"
sleep 3
systemctl status order-processor                # active again, new PID
```

Then **Submit**. The grader kills the process too and expects systemd to bring it back.
