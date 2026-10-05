#!/usr/bin/env bash
# A flaky order-sync job image (always fails after a few seconds) and the service images.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull devsetu/order-processor:v1.2 devsetu/notification-service:v1.1 alpine:3.20

box_script <<'EOF'
docker rm -f order-processor order-sync notification-service >/dev/null 2>&1 || true
rm -rf /tmp/sync && mkdir -p /tmp/sync
cat > /tmp/sync/Dockerfile <<'DOCKERFILE'
FROM alpine:3.20
CMD ["sh", "-c", "echo \"order-sync: pulling batch from partner API\"; sleep 2; echo 'order-sync: ERROR connection reset by partner' >&2; exit 1"]
DOCKERFILE
docker build -q -t quickbyte/order-sync:1.0 /tmp/sync >/dev/null
rm -rf /tmp/sync
EOF
fresh_answers
ok "order box ready"
