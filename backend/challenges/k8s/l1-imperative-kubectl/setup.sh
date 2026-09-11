#!/usr/bin/env bash
# l1-imperative-kubectl — clean slate for pop-up Deployment/Service.
set -euo pipefail

: "${LEARNER_NS:?LEARNER_NS required}"
: "${CHALLENGE_ID:?CHALLENGE_ID required}"

kubectl -n "$LEARNER_NS" delete deploy,svc,pod pop-up --ignore-not-found --wait=false >/dev/null 2>&1 || true

echo "setup ok: empty slate for imperative pop-up stack in ${LEARNER_NS}"
