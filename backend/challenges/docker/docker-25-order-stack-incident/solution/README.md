# Solution — Order Stack Incident

No new commands here: this is the whole module in one outage. The habit that matters is the order you work in: **observe, read the error, fix one thing, check again**, instead of changing five things and hoping.

## 1. What's on the box?

```bash
cd ~/order-stack
cat INCIDENT.txt
docker ps -a
docker compose ps -a
```

`debug-nginx` is up with `0.0.0.0:8080->80/tcp`, and nothing from the order stack is running.

## 2. Try to start the stack and read the first error

```bash
docker compose up -d
# Error response from daemon: manifest for devsetu/payment-handler:v1.3 not found
```

INCIDENT.txt says production runs **v1.1**. Fix the tag in compose.yaml and try again:

```bash
sed -i 's#devsetu/payment-handler:v1.3#devsetu/payment-handler:v1.1#' compose.yaml
docker compose up -d
# dependency failed to start: container order-stack-notification-service-1 is unhealthy
```

## 3. The unhealthy dependency

```bash
docker inspect --format '{{json .State.Health.Log}}' order-stack-notification-service-1 | jq '.[-1].Output'
# ConnectionRefusedError ... 127.0.0.1:8000
```

notification-service listens on **8080** (`EXPOSE 8080` in its image, and INCIDENT.txt says so too). Its healthcheck probes 8000. Change the healthcheck URL to `http://127.0.0.1:8080/health`.

## 4. The port

```bash
docker compose up -d
# Bind for 0.0.0.0:8080 failed: port is already allocated
docker ps --filter publish=8080        # debug-nginx
echo debug-nginx > ~/answers/port-thief
docker rm -f debug-nginx
```

`docker stop` alone isn't enough: it has `--restart always`, so it would come back on the next Docker restart.

## 5. order-processor can't reach payments

```bash
docker compose up -d
docker compose exec order-processor python -c \
  "import urllib.request as u; print(u.urlopen('http://payment-handler:8000/health').read())"
# Name or service not known
docker network inspect order-stack_orders-net -f '{{range .Containers}}{{.Name}} {{end}}'
```

payment-handler sits alone on `payments-net`. Containers only resolve names of containers on a **shared** network. Put payment-handler on `orders-net` too (or add `payments-net` to order-processor).

## The fixed compose.yaml

```yaml
services:
  payment-handler:
    image: devsetu/payment-handler:v1.1
    restart: unless-stopped
    networks: [orders-net, payments-net]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
      interval: 5s
      timeout: 3s
      retries: 3

  notification-service:
    image: devsetu/notification-service:v1.1
    restart: unless-stopped
    networks: [orders-net]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2)"]
      interval: 5s
      timeout: 3s
      retries: 3

  order-processor:
    image: devsetu/order-processor:v1.2
    restart: unless-stopped
    ports:
      - "8080:8000"
    env_file: order-processor.env
    networks: [orders-net]
    depends_on:
      payment-handler:
        condition: service_healthy
      notification-service:
        condition: service_healthy

networks:
  orders-net:
  payments-net:
```

## 6. Verify like a customer

```bash
docker compose up -d --wait
docker compose ps
curl -s -X POST http://127.0.0.1:8080/orders -H 'Content-Type: application/json' \
  -d '{"items":["masala-dosa"],"total":99}'
```

For the post-mortem: four separate causes (a tag that was never published, a probe on the wrong port, a forgotten container, a network mismatch), each one hidden behind the one before it.

Then **Submit**. The grader recreates the stack from compose.yaml.
