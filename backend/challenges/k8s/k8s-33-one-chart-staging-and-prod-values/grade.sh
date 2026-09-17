#!/usr/bin/env bash
# Grade k8s-33-one-chart-staging-and-prod-values — staging values install.
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

DEPLOY="notification-service"
WANT_REPLICAS="1"
WANT_TAG="v1.1-rc"
WANT_REPO="rithvikreddyalkanti/notification-service"

if ! kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DEPLOY} not found — install with staging values"
fi

DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"

[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "staging replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"
[[ "$IMAGE" == *"${WANT_TAG}"* ]] || fail "image tag must contain ${WANT_TAG} (got '${IMAGE}')"
[[ "$IMAGE" == *"${WANT_REPO}"* ]] || fail "image repository must be ${WANT_REPO} (got '${IMAGE}')"

SOFT=""
if command -v helm >/dev/null 2>&1; then
  STATUS="$(helm status notifications -n "$LEARNER_NS" 2>/dev/null | awk '/STATUS:/ {print $2; exit}' || true)"
  if [[ -n "$STATUS" && "$STATUS" != "deployed" ]]; then
    fail "Helm release notifications STATUS must be deployed (got '${STATUS}')"
  fi
  [[ -n "$STATUS" ]] || SOFT=" (soft: Helm release not found — graded Deployment image/replicas only)"
else
  SOFT=" (soft: helm CLI absent — graded Deployment only; values-prod.yaml presence not checked in-cluster)"
fi

pass "staging values applied: deploy/${DEPLOY} 1/1 Ready on image containing ${WANT_TAG}${SOFT}"
