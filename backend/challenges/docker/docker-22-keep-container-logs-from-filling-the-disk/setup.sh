#!/usr/bin/env bash
# Docker's default log options removed (json-file, unbounded), and a chatty notifier that
# has already written tens of MB of logs.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull alpine:3.20 devsetu/notification-service:v1.1

box_script <<'EOF'
docker rm -f notifier-chatty notifier >/dev/null 2>&1 || true
jq 'del(."log-opts")' /etc/docker/daemon.json > /tmp/daemon.json && mv /tmp/daemon.json /etc/docker/daemon.json
chmod 644 /etc/docker/daemon.json
systemctl restart docker
for i in $(seq 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
docker run -d --name notifier-chatty alpine:3.20 sh -c \
  'i=0; while [ $i -lt 400000 ]; do echo "notify: queued MSG-$i for order ORD-$i via email (template order-confirmed)"; i=$((i+1)); done; sleep infinity' >/dev/null
for i in $(seq 60); do
  [ "$(stat -c %s "$(docker inspect -f '{{.LogPath}}' notifier-chatty)")" -gt 40000000 ] && break
  sleep 1
done
install -d -m 700 /root/.lab
docker inspect -f '{{.LogPath}}' notifier-chatty > /root/.lab/log-path
jq -c '."registry-mirrors"' /etc/docker/daemon.json > /root/.lab/mirrors
EOF
fresh_answers
ok "order box ready"
