#!/usr/bin/env bash
# Grade l1-namespace-and-pod — namespaced checks only.
set -euo pipefail

: "${LEARNER_NS:?LEARNER_NS required}"
: "${CHALLENGE_ID:?CHALLENGE_ID required}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
  exit 0
}

POD_NAME="front-desk"

if ! kubectl -n "$LEARNER_NS" get pod "$POD_NAME" >/dev/null 2>&1; then
  fail "pod/${POD_NAME} not found in namespace ${LEARNER_NS}"
fi

APP_LABEL="$(kubectl -n "$LEARNER_NS" get pod "$POD_NAME" -o jsonpath='{.metadata.labels.app}' 2>/dev/null || true)"
TIER_LABEL="$(kubectl -n "$LEARNER_NS" get pod "$POD_NAME" -o jsonpath='{.metadata.labels.tier}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get pod "$POD_NAME" -o jsonpath='{.spec.containers[0].image}' 2>/dev/null || true)"
PHASE="$(kubectl -n "$LEARNER_NS" get pod "$POD_NAME" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
PORTS="$(kubectl -n "$LEARNER_NS" get pod "$POD_NAME" -o jsonpath='{.spec.containers[0].ports[*].containerPort}' 2>/dev/null || true)"

[[ "$APP_LABEL" == "guestbook" ]] || fail "label app must be guestbook (got '${APP_LABEL}')"
[[ "$TIER_LABEL" == "frontend" ]] || fail "label tier must be frontend (got '${TIER_LABEL}')"
[[ "$IMAGE" == *nginx* ]] || fail "container image must be nginx (got '${IMAGE}')"
[[ "$PHASE" == "Running" ]] || fail "pod phase must be Running (got '${PHASE}')"

# Require containerPort 80 to be declared (not merely that nginx listens by default).
if [[ -z "$PORTS" ]]; then
  fail "containerPort 80 must be declared on the container (got no ports)"
fi
FOUND_80=0
for p in $PORTS; do
  if [[ "$p" == "80" ]]; then
    FOUND_80=1
    break
  fi
done
[[ "$FOUND_80" -eq 1 ]] || fail "containerPort must include 80 (got '${PORTS}')"

pass "pod/${POD_NAME} is Running in ${LEARNER_NS} with required labels and port 80"
