#!/usr/bin/env bash
# Two order-processor releases on the box: 1.7 (good) and 1.8, which binds gunicorn to
# 127.0.0.1 inside the container so nothing outside it can connect. latest -> 1.8, and
# order-processor runs :latest.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull devsetu/order-processor:v1.2

box_script <<'EOF'
docker rm -f order-processor >/dev/null 2>&1 || true
docker rmi -f quickbyte/order-processor:1.7 quickbyte/order-processor:1.8 quickbyte/order-processor:latest >/dev/null 2>&1 || true
rm -rf /tmp/rel && mkdir -p /tmp/rel/1.7 /tmp/rel/1.8
cat > /tmp/rel/1.7/Dockerfile <<'DOCKERFILE'
FROM devsetu/order-processor:v1.2
ENV APP_VERSION=v1.7
LABEL org.opencontainers.image.version="1.7" com.quickbyte.change="faster order IDs"
DOCKERFILE
cat > /tmp/rel/1.8/Dockerfile <<'DOCKERFILE'
FROM devsetu/order-processor:v1.2
ENV APP_VERSION=v1.8
LABEL org.opencontainers.image.version="1.8" com.quickbyte.change="harden gunicorn bind"
CMD ["gunicorn", "--bind", "127.0.0.1:8000", "--workers", "1", "--threads", "2", "app:app"]
DOCKERFILE
docker build -q -t quickbyte/order-processor:1.7 /tmp/rel/1.7 >/dev/null
docker build -q -t quickbyte/order-processor:1.8 -t quickbyte/order-processor:latest /tmp/rel/1.8 >/dev/null
rm -rf /tmp/rel
docker run -d --name order-processor --restart unless-stopped -p 8080:8000 quickbyte/order-processor:latest >/dev/null
EOF
fresh_answers
ok "order-processor is running :latest"
