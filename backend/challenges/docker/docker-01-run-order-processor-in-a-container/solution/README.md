# Solution — Run Order Processor in a Container

On a plain server you installed order-processor, wrote a systemd unit and opened a port. With Docker, the image already contains the app and everything it needs; you choose **which version**, **which port** and **which settings** when you start it.

Docs: `docker run --help` (look for `-p`, `-e`, `--name`, `-d`) · `docker exec --help`

## Clear the name

```bash
docker ps -a
# order-processor   devsetu/order-processor:v1.0   Created
docker run -d --name order-processor devsetu/order-processor:v1.1
# Error: Conflict. The container name "/order-processor" is already in use
docker rm order-processor
```

Names are unique per machine. A container that was only **created** (never started) still holds its name until you remove it.

## Pull and run v1.1

```bash
docker pull devsetu/order-processor:v1.1
docker run -d --name order-processor \
  -p 8080:8000 \
  -e LOG_LEVEL=DEBUG \
  devsetu/order-processor:v1.1
docker ps
docker logs order-processor
```

- `-p 8080:8000` publishes **host** port 8080 to **container** port 8000. The app listens on 8000 inside its own network namespace; without `-p` nothing outside the container can reach it.
- `-e LOG_LEVEL=DEBUG` sets an environment variable for the process. Same image, different settings: no rebuild.
- `docker pull` is optional (`run` pulls a missing image), but it's good to see where images come from: `devsetu/order-processor` on Docker Hub, tag `v1.1`.

## Check it and place an order

```bash
curl http://127.0.0.1:8080/health
# {"status":"ok","version":"v1.1"}

curl -s -X POST http://127.0.0.1:8080/orders \
  -H 'Content-Type: application/json' \
  -d '{"customer_id":"c-42","items":["masala-dosa"],"total":25}'
# {"order_id":"ORD-1A2B3C4D","status":"created",...}

mkdir -p ~/answers
curl -s -X POST http://127.0.0.1:8080/orders -H 'Content-Type: application/json' \
  -d '{"customer_id":"c-42","items":["masala-dosa"],"total":25}' | jq -r .order_id > ~/answers/order-id
docker logs order-processor | tail -3   # INFO created ORD-...
```

## Look inside the running container

```bash
docker exec order-processor id -un      # nobody
docker exec order-processor id -un > ~/answers/app-user
docker exec -it order-processor sh      # an interactive shell inside; exit to leave
docker inspect order-processor | less   # everything Docker knows: env, ports, mounts, state
```

`docker exec` runs an extra process in an existing container. The image's Dockerfile set `USER nobody`, so the app doesn't run as root, just like `User=orders` in the systemd unit from the Linux track.

Then **Submit**.
