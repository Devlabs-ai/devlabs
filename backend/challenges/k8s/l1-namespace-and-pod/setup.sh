#!/usr/bin/env bash
# l1-namespace-and-pod — namespace is provisioned by the platform; clear leftover decoys.
set -euo pipefail

: "${LEARNER_NS:?LEARNER_NS required}"
: "${CHALLENGE_ID:?CHALLENGE_ID required}"

# Remove leftovers from older Guestbook / decoy briefs (harmless if already gone).
kubectl -n "$LEARNER_NS" delete pod wrong-room-decoy --ignore-not-found --wait=false >/dev/null 2>&1 || true
kubectl -n "$LEARNER_NS" delete pod front-desk --ignore-not-found --wait=false >/dev/null 2>&1 || true

echo "setup ok: empty workspace in ${LEARNER_NS}"
