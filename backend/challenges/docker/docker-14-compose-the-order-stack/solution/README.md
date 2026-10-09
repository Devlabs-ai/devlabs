# Solution — Compose the Order Stack

Two `docker run` commands with a dozen flags each, a network you must remember to create, and an order to start them in: that's what **Docker Compose** replaces. You describe the stack once in `compose.yaml`; `docker compose up -d` creates the network and containers, in the right order, every time.

Docs: [Compose file reference](https://docs.docker.com/reference/compose-file/) · `docker compose --help`

## compose.yaml

```bash
cd ~/order-stack
cat order-processor.env      # the settings ops gave you
nano compose.yaml
```

```yaml
services:
  payment-handler:
    image: devsetu/payment-handler:v1.1
    restart: unless-stopped
    networks: [orders-net]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 5s

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

networks:
  orders-net:
```

- **Project**: Compose names everything after the folder, `order-stack`. Containers become `order-stack-order-processor-1`, the network `order-stack_orders-net`.
- **Service names are DNS names** on the network. order-processor reaches `http://payment-handler:8000` with no IPs and no `/etc/hosts`.
- **Only order-processor has `ports:`**. payment-handler is reachable from orders-net but not from outside the box. Publish only what users need.
- **`env_file`** keeps settings (and the API key) out of `compose.yaml`, so the file can be committed and shared.
- **`depends_on` with `condition: service_healthy`** starts order-processor only once payment-handler's healthcheck passes. Plain `depends_on` only waits for the container to *start*, not for the app to be ready.
- **`restart: unless-stopped`**: restart after crashes and reboots, but not if you stopped it on purpose.

## Bring it up

```bash
docker compose config        # validate, and show the file with env_file values resolved
docker compose up -d
docker compose ps            # payment-handler (healthy), then order-processor Up
docker compose logs -f order-processor     # Ctrl+C to stop following
```

## Try it

```bash
curl http://127.0.0.1:8080/health
curl -s -X POST http://127.0.0.1:8080/orders -H 'Content-Type: application/json' \
  -d '{"items":["chai"],"total":99}'
docker compose exec order-processor python -c \
  "import urllib.request; print(urllib.request.urlopen('http://payment-handler:8000/health').read())"
curl http://127.0.0.1:8000/health          # fails: payment-handler isn't published
```

## Day-2 commands

```bash
docker compose restart order-processor
docker compose down          # stop and remove containers + network (named volumes stay)
docker compose up -d         # back again, identical
```

Leave the stack **running**, then **Submit**.
