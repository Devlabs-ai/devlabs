#!/usr/bin/env bash
# l1-deployment-basics — clear leftover bare pod from lab 1 if present.
set -euo pipefail

: "${LEARNER_NS:?LEARNER_NS required}"
: "${CHALLENGE_ID:?CHALLENGE_ID required}"

# Lab 1 used a Pod named front-desk; this lab needs a Deployment with that name.
kubectl -n "$LEARNER_NS" delete pod front-desk --ignore-not-found --wait=false >/dev/null 2>&1 || true

echo "setup ok: ready for Deployment front-desk in ${LEARNER_NS}"
