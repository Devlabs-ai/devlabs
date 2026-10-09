#!/usr/bin/env bash
# A payment-handler image with an (old, now revoked) API key baked in with ENV, and a
# ~/payments Compose project that passes the new key as a plain environment variable.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

old="pk_live_$(printf '%04x%04x%04x' $RANDOM $RANDOM $RANDOM)"
new="pk_live_$(printf '%04x%04x%04x' $RANDOM $RANDOM $RANDOM)"

wait_docker
prepull devsetu/payment-handler:v1.1

box_script <<EOF
rm -rf /home/learner/payments /tmp/leaky
docker rmi -f quickbyte/payment-handler:1.1-hotfix >/dev/null 2>&1 || true
mkdir -p /tmp/leaky
cat > /tmp/leaky/Dockerfile <<'DOCKERFILE'
FROM devsetu/payment-handler:v1.1
ENV PAYMENT_API_KEY=$old
LABEL com.quickbyte.note="hotfix build, do not ship"
DOCKERFILE
docker build -q -t quickbyte/payment-handler:1.1-hotfix /tmp/leaky >/dev/null
rm -rf /tmp/leaky

install -d -o learner -g learner /home/learner/payments /home/learner/payments/secrets
printf '%s\n' "$new" > /home/learner/payments/secrets/payment_api_key.txt
chmod 644 /home/learner/payments/secrets/payment_api_key.txt
cat > /home/learner/payments/compose.yaml <<'YAML'
services:
  payment-handler:
    image: quickbyte/payment-handler:1.1-hotfix
    restart: unless-stopped
    environment:
      - PAYMENT_API_KEY=$new
YAML
chown -R learner:learner /home/learner/payments
install -d -m 700 /root/.lab
printf '%s %s\n' "$old" "$new" > /root/.lab/keys
EOF
fresh_answers
ok "~/payments ready"
