# Solution — Why Can't Order Reach Payment?

Debug a connection from the bottom up. Who am I on the network? What does the name resolve to? Is anything listening on that port? Does the request work?

Docs: `man ip` · `man ss` · `man getent` · `man dig` · `man hosts` · `man resolv.conf`

## Reproduce

```bash
/opt/order-processor/bin/check-payments
cat /etc/order-processor/app.conf          # http://payment.internal:9090
```

## Where am I?

```bash
mkdir -p ~/answers
ip -4 addr show dev eth0                   # inet 10.x.y.z/..
ip route                                   # default gateway
cat /etc/resolv.conf                       # nameserver ...
echo 10.x.y.z > ~/answers/box-ip           # your address, without the /prefix
awk '/^nameserver/{print $2; exit}' /etc/resolv.conf > ~/answers/resolver
```

## Name resolution

```bash
getent hosts payment.internal              # 10.99.0.7 — what programs actually use
dig +short payment.internal                # nothing: dig only asks DNS and skips /etc/hosts
grep payment /etc/hosts
echo 10.99.0.7 > ~/answers/payment-ip-before
```

`/etc/nsswitch.conf` (`hosts: files dns`) is why `/etc/hosts` wins over DNS.

## Is anything listening?

```bash
sudo ss -tlnp                              # nothing on :9090; something on 127.0.0.1:9099
systemctl status payment-handler           # the process tree shows its nc listener's PID
journalctl -u payment-handler -n 5         # "listening on 127.0.0.1:9099"
echo 9099 > ~/answers/payment-port-before
```

`ss` names the process that owns the socket: here that's the `nc` helper that payment-handler started. Match the PID against `systemctl status` to tie the port to the service.

## Fix both

```bash
sudo nano /etc/hosts        # change 10.99.0.7 to 127.0.0.1 on the payment.internal line
getent hosts payment.internal
# sed -i fails on this /etc/hosts ("Device or resource busy"): in a container it is a
# bind-mounted file, and sed -i replaces files by renaming. Editors that write in place work.

sudo sed -i 's/^PAYMENT_HANDLER_PORT=.*/PAYMENT_HANDLER_PORT=9090/' /etc/payment-handler/payment-handler.env
sudo systemctl restart payment-handler
ss -tln | grep 9090

curl -v http://payment.internal:9090/health
/opt/order-processor/bin/check-payments
```

Then **Submit**.
