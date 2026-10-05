#!/usr/bin/env bash
# ~/order-stack with a schema migration job, the slow-booting order-processor build and
# notification-service. The given compose.yaml starts everything at once and gives
# order-processor a healthcheck too impatient for its 25 s boot.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull devsetu/slow-order-processor:1.0 devsetu/notification-service:v1.1 alpine:3.20

box_script <<'EOF'
rm -rf /home/learner/order-stack /tmp/migrate
mkdir -p /tmp/migrate
cat > /tmp/migrate/migrate.sh <<'SH'
#!/bin/sh
set -e
echo "migrate: applying 0001_orders.sql ... 0007_order_items_index.sql"
sleep 4
echo 7 > /schema/version
echo "migrate: schema at version 7"
SH
cat > /tmp/migrate/Dockerfile <<'DOCKERFILE'
FROM alpine:3.20
COPY migrate.sh /migrate.sh
RUN chmod +x /migrate.sh
VOLUME /schema
CMD ["/migrate.sh"]
DOCKERFILE
docker build -q -t quickbyte/order-migrate:1.0 /tmp/migrate >/dev/null
rm -rf /tmp/migrate

install -d -o learner -g learner /home/learner/order-stack
cat > /home/learner/order-stack/compose.yaml <<'YAML'
services:
  migrate:
    image: quickbyte/order-migrate:1.0
    volumes:
      - schema:/schema

  order-processor:
    image: devsetu/slow-order-processor:1.0
    restart: unless-stopped
    ports:
      - "8080:8000"
    volumes:
      - schema:/schema:ro
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
      interval: 2s
      timeout: 2s
      retries: 1
    depends_on:
      - migrate

  notification-service:
    image: devsetu/notification-service:v1.1
    restart: unless-stopped
    depends_on:
      - order-processor

volumes:
  schema:
YAML
chown learner:learner /home/learner/order-stack/compose.yaml
EOF
fresh_answers
ok "~/order-stack ready"
