# Solution — Publish Only the Ports You Need

Containers on the same network talk to each other directly, on any port. **Publishing** (`-p`) is only for traffic coming from **outside** Docker: other machines, or the host itself. Every published port is something that can be scanned and attacked, so publish only what users need, and only on the interface they come from.

Docs: [Published ports](https://docs.docker.com/engine/network/port-publishing/)

## See what's exposed

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
# payment-handler        0.0.0.0:8000->8000/tcp, [::]:8000->8000/tcp
# notification-service   0.0.0.0:8090->8080/tcp, ...
docker port notification-service
hostname -I                          # the box's own address
curl http://$(hostname -I | awk '{print $1}'):8000/health   # payments, open to the network
```

`-p 8000:8000` means **0.0.0.0** (every interface, IPv4 and IPv6): anyone who can reach the machine can reach the container. Docker also writes its own firewall rules for published ports, so a host firewall like `ufw` often **doesn't** block them.

## Recreate with the right ports

Ports are fixed when a container is created, so recreate the two that are wrong:

```bash
docker rm -f payment-handler notification-service
docker run -d --name payment-handler --network orders-net devsetu/payment-handler:v1.1
docker run -d --name notification-service --network orders-net \
  -p 127.0.0.1:8090:8080 devsetu/notification-service:v1.1
```

- **payment-handler**: no `-p` at all. order-processor reaches it as `payment-handler:8000` over `orders-net`; nothing else needs it.
- **notification-service**: `127.0.0.1:` binds the published port to the loopback interface only. Admins on the box can use it; other machines can't.
- **order-processor** keeps `-p 8080:8000`: it's the one service customers call.

## Check from both sides

```bash
IP=$(hostname -I | awk '{print $1}')
curl -s -o /dev/null -w '%{http_code}\n' http://$IP:8080/health      # 200
curl -s -o /dev/null -w '%{http_code}\n' --max-time 3 http://$IP:8090/health   # 000: refused
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/health # 200
docker exec order-processor python -c "import urllib.request as u; print(u.urlopen('http://payment-handler:8000/health').read())"
```

This is the same idea as a Kubernetes Service type: `ClusterIP` (internal only) for most services, `NodePort` / `LoadBalancer` for the few that face users.

Then **Submit**.
