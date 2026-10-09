# Solution — Connect Services on a User-Defined Network

Every container gets an IP, but IPs change whenever a container is recreated, so services should find each other **by name**. Docker runs a small DNS server for this, at `127.0.0.11` inside each container, but only on **user-defined networks**. The default `bridge` network has no name resolution at all.

Docs: [Bridge networks](https://docs.docker.com/engine/network/drivers/bridge/) · `docker network --help`

## See the problem

```bash
docker network ls                     # bridge, host, none
docker exec order-processor python -c \
  "import urllib.request; print(urllib.request.urlopen('http://payment-handler:8000/health').read())"
# urllib.error.URLError: <urlopen error [Errno -2] Name or service not known>
docker inspect -f '{{.NetworkSettings.IPAddress}}' payment-handler   # works by IP, until it changes
```

## Create a network and connect the running containers

```bash
docker network create quickbyte-net
docker network connect quickbyte-net order-processor
docker network connect --alias payments quickbyte-net payment-handler
docker network disconnect bridge payment-handler
```

- `docker network connect` attaches a **running** container to another network, with no restart: it gets a second network interface.
- `--alias payments` adds an extra DNS name on that network. Handy when clients expect a different name (`payments`) than the container's (`payment-handler`).
- payment-handler is an internal service: taking it off `bridge` leaves it reachable only by what's on `quickbyte-net`.

## Start notification-service straight on the network

```bash
docker run -d --name notification-service --network quickbyte-net devsetu/notification-service:v1.1
```

## Check

```bash
docker network inspect quickbyte-net | jq '.[0].Containers'
docker exec order-processor python -c "import urllib.request as u; print(u.urlopen('http://payments:8000/health').read())"
docker exec order-processor python -c "import urllib.request as u; print(u.urlopen('http://notification-service:8080/health').read())"
docker exec order-processor cat /etc/resolv.conf     # nameserver 127.0.0.11: Docker's embedded DNS
docker inspect -f '{{(index .NetworkSettings.Networks "quickbyte-net").IPAddress}}' payment-handler > ~/answers/payment-ip
```

Compose does all of this for you: every project gets its own network and every service is reachable by its name. In Kubernetes the same idea is a **Service**: a stable DNS name in front of pods whose IPs come and go.

Then **Submit**.
