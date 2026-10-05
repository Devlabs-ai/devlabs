#!/usr/bin/env bash
# notification-service 1.2 checks its settings at startup and exits 78 (EX_CONFIG) when
# something is wrong. It's running with three problems stacked: no SMTP_HOST, the config
# mounted at the wrong path, and a config file that isn't valid JSON.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

sender="orders-$(printf '%04x' $RANDOM)@quickbyte.example"

wait_docker
prepull devsetu/notification-service:v1.1

box_script <<EOF
docker rm -f notification-service >/dev/null 2>&1 || true
rm -rf /tmp/ns /home/learner/notify && mkdir -p /tmp/ns
cat > /tmp/ns/entrypoint.sh <<'SH'
#!/bin/sh
if [ -z "\${SMTP_HOST:-}" ]; then
  echo "notification-service: FATAL: SMTP_HOST is not set" >&2; exit 78
fi
if [ ! -r /etc/notify/config.json ]; then
  echo "notification-service: FATAL: cannot read /etc/notify/config.json" >&2; exit 78
fi
if ! python -c 'import json; json.load(open("/etc/notify/config.json"))' 2>/tmp/err; then
  echo "notification-service: FATAL: /etc/notify/config.json is not valid JSON: \$(tail -n1 /tmp/err)" >&2; exit 78
fi
echo "notification-service: sending via \$SMTP_HOST"
exec gunicorn --bind 0.0.0.0:8080 --workers 1 --threads 2 app:app
SH
cat > /tmp/ns/Dockerfile <<'DOCKERFILE'
FROM devsetu/notification-service:v1.1
COPY --chmod=755 entrypoint.sh /entrypoint.sh
ENV APP_VERSION=v1.2
ENTRYPOINT ["/entrypoint.sh"]
CMD []
DOCKERFILE
docker build -q -t quickbyte/notification-service:1.2 /tmp/ns >/dev/null
rm -rf /tmp/ns

install -d -o learner -g learner /home/learner/notify
cat > /home/learner/notify/config.json <<'JSON'
{
  "sender": "$sender",
  "channels": ["email", "sms"],
  "retry": {"attempts": 3, "backoff_seconds": 10},
}
JSON
cat > /home/learner/notify/README.txt <<'TXT'
notification-service (ops notes)
- SMTP relay: smtp.quickbyte.internal
- config: ~/notify/config.json, mounted read-only at /etc/notify/config.json
- port 8080 inside the container, published on the box as 8090
TXT
chown -R learner:learner /home/learner/notify
docker run -d --name notification-service --restart always -p 8090:8080 \
  -v /home/learner/notify/config.json:/etc/notify.json:ro quickbyte/notification-service:1.2 >/dev/null
install -d -m 700 /root/.lab
echo "$sender" > /root/.lab/sender
EOF
fresh_answers
ok "notification-service is deployed"
