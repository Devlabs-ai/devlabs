#!/usr/bin/env bash
# l1-namespace-and-pod — namespace is provisioned by the platform; clear legacy decoy if present.
set -euo pipefail

: "${LEARNER_NS:?LEARNER_NS required}"
: "${CHALLENGE_ID:?CHALLENGE_ID required}"

# Remove leftover from the old decoy-based brief (harmless if already gone).
kubectl -n "$LEARNER_NS" delete pod wrong-room-decoy --ignore-not-found --wait=false >/dev/null 2>&1 || true

echo "setup ok: empty workspace in ${LEARNER_NS}"
