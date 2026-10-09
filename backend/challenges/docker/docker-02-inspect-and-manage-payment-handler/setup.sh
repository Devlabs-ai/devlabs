#!/usr/bin/env bash
# A running payment-handler with a per-session merchant ID and receipt inside it, plus a
# crashed one-off container with a per-session exit code.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

merchant="M-$(printf '%04X%04X' $RANDOM $RANDOM)"
receipt="RCPT-$(printf '%04x%04x' $RANDOM $RANDOM)"
code=$((RANDOM % 50 + 3))

wait_docker
prepull devsetu/payment-handler:v1.0 alpine:3.20

box_script <<EOF
docker rm -f payment-handler settlement-job >/dev/null 2>&1 || true
docker run -d --name payment-handler -e MERCHANT_ID=$merchant -e PAYMENT_REGION=ap-south-2 \
  devsetu/payment-handler:v1.0 >/dev/null
docker exec payment-handler sh -c 'echo "receipt $receipt for batch 2026-10-01" > /tmp/last-receipt.txt'
docker run --name settlement-job alpine:3.20 sh -c 'echo "settling 1,204 payments"; echo "ERROR: bank API timeout"; exit $code' >/dev/null 2>&1 || true
install -d -m 700 /root/.lab
echo $code > /root/.lab/settlement-code
docker inspect -f '{{.State.StartedAt}}' payment-handler > /root/.lab/started-at
EOF
fresh_answers
ok "payment-handler is running"
